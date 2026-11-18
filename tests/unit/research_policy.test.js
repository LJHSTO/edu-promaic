import test from 'node:test';
import assert from 'node:assert/strict';
import evidenceModule from '../../code/core_engine/research_policy/evidence-package.cjs';
import timingModule from '../../code/core_engine/research_policy/timing-gate.cjs';
import actionModule from '../../code/core_engine/research_policy/support-action.cjs';

const { EvidencePackage } = evidenceModule;
const { TimingGate } = timingModule;
const { SupportAction } = actionModule;
const facts = { current_kp: 'demo-limit', event_type: 'formative_error', timestamp: 1 };
const hint = {
  depth: 'L2', functionType: 'concept_hint', targetKp: facts.current_kp,
  contentText: '比较点的取值和附近趋势。',
  remainingStudentTask: '独立作答', followupCheckId: 'demo-transfer'
};

test('将缺失推断与可观察事实分别记录', () => {
  const packet = new EvidencePackage({ facts });
  assert.equal(packet.inference.need_help_now, null);
  assert.ok(packet.missing.includes('need_help_now'));
  assert.ok(Object.isFrozen(packet.facts));
  assert.throws(() => new EvidencePackage());
});

test('可打断的练习边界产生建议，测量阶段保持沉默', () => {
  const evidence = new EvidencePackage({ facts, inference: { need_help_now: 0.8, interruptible_now: 0.8 } });
  const gate = new TimingGate();
  assert.equal(gate.evaluate({ evidence, atBoundary: true }).action, 'boundary');
  assert.equal(gate.evaluate({ evidence, assessmentPhase: 'post', atBoundary: true }).action, 'silent');
});

test('支架保留独立复查并拒绝已标记的答案泄露', () => {
  assert.equal(new SupportAction(hint).toJSON().followup_check_id, 'demo-transfer');
  assert.throws(() => new SupportAction({ ...hint, leaksCurrentAnswer: true }), /leaking/);
});

test('复制嵌套来源，冻结证据时不修改调用方数据', () => {
  const source = { section: { id: 'example' } };
  const packet = new EvidencePackage({
    facts: { ...facts, references: [source], observable_features: { errors: 2 } },
    inference: { need_help_now: 5 }, provenance: { evidence_window_seconds: 0 }
  });
  source.section.id = 'changed';
  assert.equal(packet.toJSON().facts.references[0].section.id, 'example');
  assert.equal(packet.inference.need_help_now, null);
  assert.equal(packet.provenance.evidence_window_seconds, 0);
  assert.ok(new EvidencePackage({ facts: { ...facts, timestamp: undefined } }).missing.includes('timestamp'));
});

test('依次核对保护、偏好、冷却、证据和打断条件', () => {
  const gate = new TimingGate();
  const evidenceFor = (need, interrupt) => new EvidencePackage({
    facts, inference: { need_help_now: need, interruptible_now: interrupt }
  });
  const evidence = evidenceFor(1, 1);
  assert.equal(gate.evaluate({ evidence, assessmentPhase: 'verification',
    verifiedReflectionOpportunity: true }).reason, 'protected_assessment_phase');
  assert.equal(gate.evaluate({ evidence, studentAuthority: { proactive_preference: 'off' } }).action, 'silent');
  assert.equal(gate.evaluate({ evidence, cooldownState: { activeUntil: Date.now() + 60_000 } }).reason, 'cooling_down');
  assert.equal(gate.evaluate({ evidence: evidenceFor(null, 1) }).reason, 'required_evidence_missing');
  assert.equal(gate.evaluate({ evidence: evidenceFor(0, 1) }).action, 'silent');
  assert.equal(gate.evaluate({ evidence: evidenceFor(1, 0) }).action, 'wait');
  assert.equal(gate.evaluate({ evidence }).action, 'immediate');
  assert.equal(gate.evaluate({ evidence, atBoundary: true, verifiedReflectionOpportunity: true }).action, 'boundary');
  assert.equal(gate.evaluate({ evidence, verifiedReflectionOpportunity: true }).action, 'wait');
  assert.throws(() => gate.evaluate(), TypeError);
  assert.throws(() => new TimingGate({ cooldownMs: -1 }), TypeError);
  assert.throws(() => new TimingGate({ helpNeedThreshold: Infinity }), TypeError);
});

test('拒绝无效支架字段，L0 输出无提示', () => {
  for (const invalid of [{ depth: 'L6' }, { functionType: 'unknown' },
    { followupCheckId: ' ' }, { followupCheckId: {} }, { leaksCurrentAnswer: 'false' }]) {
    assert.throws(() => new SupportAction({ ...hint, ...invalid }), TypeError);
  }
  assert.equal(new SupportAction({ depth: 'L0' }).toJSON().content_text, '');
});

test('调用方对公开阶段集合的修改不会改变内部保护规则', () => {
  const phases = timingModule.PROTECTED_PHASES;
  phases.delete('verification');
  try {
    const gate = new TimingGate();
    const evidence = new EvidencePackage({ facts, inference: { need_help_now: 1, interruptible_now: 1 } });
    assert.equal(gate.evaluate({ evidence, assessmentPhase: 'verification' }).action, 'silent');
  } finally {
    phases.add('verification');
  }
});
