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
