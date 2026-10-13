const assert = require('assert');
const iconv = require('iconv-lite');

const { parseSubtitle, decodeSubtitleBuffer, parseSRT, parseSMI, parseVTT } = require('../lib/subtitleParser');
const { serializeSubtitle, toSRT, toSMI, toVTT } = require('../lib/subtitleSerializer');
const { calculateTwoPointParameters, applyLinearSync, applyShiftOffset, identifyFpsPattern } = require('../lib/syncEngine');
const { computeVAD, findOptimalSync } = require('../lib/audioAnalyzer');

console.log('🧪 SubSync Studio 테스트 시작...');

// Test 1: SRT Parsing & Serialization
console.log('1. SRT 파싱 및 직렬화 테스트');
const sampleSRT = `
1
00:01:20,000 --> 00:01:23,500
안녕하세요 첫 번째 대사입니다.

2
00:01:25,123 --> 00:01:28,456
반갑습니다 두 번째 대사입니다.
두 번째 줄입니다.
`;

const parsedSRT = parseSubtitle(sampleSRT);
assert.strictEqual(parsedSRT.format, 'SRT');
assert.strictEqual(parsedSRT.items.length, 2);
assert.strictEqual(parsedSRT.items[0].start, 80.0);
assert.strictEqual(parsedSRT.items[0].end, 83.5);
assert.strictEqual(parsedSRT.items[0].text, '안녕하세요 첫 번째 대사입니다.');
assert.strictEqual(parsedSRT.items[1].start, 85.123);
console.log('  ✅ SRT 파싱 성공!');

const reserializedSRT = serializeSubtitle(parsedSRT.items, 'SRT');
assert(reserializedSRT.includes('00:01:20,000 --> 00:01:23,500'));
console.log('  ✅ SRT 직렬화 성공!');

// Test 2: SMI Parsing & Korean Encoding (CP949)
console.log('2. SAMI (.smi) 파싱 및 CP949 인코딩 테스트');
const sampleSMI = `
<SAMI>
<HEAD>
<TITLE>테스트 자막</TITLE>
<STYLE TYPE="text/css">
<!--
.KRCC { Name: 한국어; lang: ko-KR; SAMIType: CC; }
-->
</STYLE>
</HEAD>
<BODY>
<SYNC Start=1000><P Class=KRCC>
안녕하세요<br>만나서 반갑습니다.
<SYNC Start=4000><P Class=KRCC>&nbsp;
<SYNC Start=6000><P Class=KRCC>
영화가 시작됩니다.
<SYNC Start=9500><P Class=KRCC>&nbsp;
</BODY>
</SAMI>
`;

const cp949Buffer = iconv.encode(sampleSMI, 'cp949');
const decoded = decodeSubtitleBuffer(cp949Buffer);
assert.strictEqual(decoded.encoding, 'CP949');
assert(decoded.text.includes('만나서 반갑습니다.'));
console.log('  ✅ CP949 인코딩 자동 감지 및 디코딩 성공!');

const parsedSMI = parseSubtitle(decoded.text);
assert.strictEqual(parsedSMI.format, 'SMI');
assert.strictEqual(parsedSMI.items.length, 2);
assert.strictEqual(parsedSMI.items[0].start, 1.0);
assert.strictEqual(parsedSMI.items[0].end, 4.0);
assert.strictEqual(parsedSMI.items[0].text, '안녕하세요\n만나서 반갑습니다.');
assert.strictEqual(parsedSMI.items[1].start, 6.0);
assert.strictEqual(parsedSMI.items[1].end, 9.5);
console.log('  ✅ SAMI 구조 및 줄바꿈/태그 제거 파싱 성공!');

// Test 3: 2-Point Linear Calibration Math
console.log('3. 2-포인트 선형 비례 보정 수학 계산 테스트');
// Scenario: PAL (25fps) to NTSC (23.976fps)
// Ratio is 25 / 23.976 = ~1.042709
// Suppose at subtitle time 100.0s, video is at 105.0s (offset +0.729)
// At subtitle time 3000.0s (50 min), video is at (3000 * 1.042709 + 0.729) = 3128.856s
const p1 = { subTime: 100.0, videoTime: 105.0 };
const p2 = { subTime: 3000.0, videoTime: 3128.856 };

const params = calculateTwoPointParameters(p1, p2);
console.log('  계산 결과:', params);
assert(Math.abs(params.scale - 1.042709) < 0.001);
assert(params.pattern.includes('PAL'));
console.log('  ✅ PAL -> NTSC 자동 감지 및 비율 계산 성공!');

const synced = applyLinearSync(parsedSRT.items, params.scale, params.offset);
assert.strictEqual(synced.length, 2);
assert(synced[0].start > parsedSRT.items[0].start);
console.log('  ✅ 자막 타임스탬프 비례 재계산 성공!');

// Test 4: Audio VAD & Auto-sync Cross Correlation Simulation
console.log('4. VAD 및 자동 교차상관 싱크 엔진 시뮬레이션 테스트');
const testDurationSec = 600; // 10 minutes
const bucketsPerSec = 10;
const totalBuckets = testDurationSec * bucketsPerSec;
const testEnvelope = new Float32Array(totalBuckets);

// Simulate speech in video at seconds 105~108 and 205~208
const addSpeech = (startSec, endSec) => {
  const b1 = Math.floor(startSec * bucketsPerSec);
  const b2 = Math.floor(endSec * bucketsPerSec);
  for (let b = b1; b <= b2; b++) testEnvelope[b] = 0.5;
};
addSpeech(105, 108);
addSpeech(205, 208);

// Subtitles originally timed at 100~103 and 200~203 (i.e. offset = +5.0s, scale = 1.0)
const testSubs = [
  { start: 100, end: 103 },
  { start: 200, end: 203 }
];

const autoMatch = findOptimalSync(testEnvelope, testSubs, { minOffset: -10, maxOffset: 10, offsetStep: 0.5 });
console.log('  자동 탐색 결과:', autoMatch);
assert(Math.abs(autoMatch.offset - 5.0) <= 0.2);
assert(Math.abs(autoMatch.scale - 1.0) <= 0.01);
console.log('  ✅ 자동 교차상관 싱크 탐색 성공 (오프셋 5.0s 정확히 검출)!');

console.log('🎉 모든 핵심 기능 테스트 통과!');
