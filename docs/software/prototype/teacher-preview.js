// Deliberately synthetic fixtures; never mix these with live student records.
export const previewSessions = [
  { id: 'DEMO-01', supported: true, result: 'first', resultLabel: '首次独立通过', events: [
    ['练习连续两次错误', '例：把点值当成极限；仅为选项标注，不是认知诊断。'],
    ['出现 L1 自我解释线索', 'REPEATED_ERRORS · limit-v1 · 规则版本 0.1'],
    ['使用线索后完成练习', '辅助完成单列，不计为独立掌握。'],
    ['首次独立验证通过', '验证阶段清空线索；PROTECTED_ASSESSMENT。']
  ] },
  { id: 'DEMO-02', supported: true, result: 'retry', resultLabel: '重试后完成', events: [
    ['学生主动请求线索', 'REQUESTED_HELP · L1 · limit-v1'],
    ['使用线索后完成练习', '进入受保护验证阶段。'],
    ['首次验证错误', '保持沉默，不返回概念线索。'],
    ['第二次提交后完成', '记录为重试完成，不计入首次通过。']
  ] },
  { id: 'DEMO-03', supported: false, result: 'first', resultLabel: '首次独立通过', events: [
    ['首次练习独立答对', '未查看线索。'],
    ['进入独立验证', '旧线索清空，求助关闭。'],
    ['首次独立验证通过', '仅为一次任务表现，不等同长期掌握。']
  ] },
  { id: 'DEMO-04', supported: false, result: 'pending', resultLabel: '验证尚未开始', events: [
    ['打开练习', '会话启动。'],
    ['关闭本题主动提示', 'USER_OPTED_OUT · 尊重学生控制。'],
    ['尚未提交验证', '结果缺失单列，不按失败或通过填补。']
  ] }
];

export function filterSessions(result = 'all') {
  return previewSessions.filter(session => result === 'all' || session.result === result);
}
export function summarizeSessions(sessions) {
  return {
    total: sessions.length,
    attempted: sessions.filter(session => session.result !== 'pending').length,
    firstPass: sessions.filter(session => session.result === 'first').length,
    missing: sessions.filter(session => session.result === 'pending').length
  };
}
export function toPreviewCsv(sessions) {
  const rows = [['data_kind', 'session_id', 'used_support', 'verification_result'],
    ...sessions.map(session => ['synthetic', session.id, String(session.supported), session.result])];
  return rows.map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(',')).join('\r\n') + '\r\n';
}
