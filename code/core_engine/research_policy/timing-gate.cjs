"use strict";

/**
 * @file timing-gate.js
 * @description D2 教学时机与沉默门控器
 * 主策略调用的时机契约：区分帮助需求与可打断性；只能否决，不能绕过上游硬门控。
 */

const TIMING_ACTIONS = Object.freeze({
  SILENT: "silent",
  WAIT: "wait",
  BOUNDARY: "boundary",
  IMMEDIATE: "immediate",
  DELAYED: "delayed",
  CANCEL: "cancel"
});

const PROTECTED_PHASES = new Set([
  "pre",
  "post",
  "transfer",
  "near_transfer",
  "far_transfer",
  "retention",
  "delayed",
  "delayed_retention"
]);

class TimingGate {
  /**
   * @param {Object} [config]
   * @param {number} [config.helpNeedThreshold=0.70]
   * @param {number} [config.interruptibilityThreshold=0.60]
   * @param {number} [config.cooldownMs=300000] // 默认 5 分钟
   */
  constructor(config = {}) {
    this.helpNeedThreshold = config.helpNeedThreshold ?? 0.70;
    this.interruptibilityThreshold = config.interruptibilityThreshold ?? 0.60;
    this.cooldownMs = config.cooldownMs ?? 300000;
    for (const value of [this.helpNeedThreshold, this.interruptibilityThreshold]) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new Error("TimingGate: invalid threshold");
    }
  }

  /**
   * 评估时机决策
   * @param {Object} params
   * @param {import('./evidence-package').EvidencePackage} params.evidence
   * @param {Object} [params.cooldownState] - 知识点冷却状态 { activeUntil: number }
   * @param {Object} [params.studentAuthority] - D5 学生授权状态 { is_kp_disabled: boolean }
   * @param {string} [params.assessmentPhase="practice"] - 当前所处阶段
   * @param {boolean} [params.atBoundary=false] - 当前是否处于天然断点 (如提交后、场景切换时)
   * @returns {{ action: string, reason: string, candidate_formed: boolean, remaining_cooldown_ms?: number }}
   */
  evaluate({ evidence, cooldownState, studentAuthority, assessmentPhase = "practice", atBoundary = false, verifiedReflectionOpportunity = false } = {}) {
    if (!evidence || !evidence.inference) {
      throw new Error("TimingGate: evidence package is required");
    }

    const { need_help_now, interruptible_now } = evidence.inference;
    const now = Date.now();

    // 1. 测量保护硬门控：测量阶段必须强制绝对沉默
    if (PROTECTED_PHASES.has(String(assessmentPhase || "").toLowerCase())) {
      return {
        action: TIMING_ACTIONS.SILENT,
        reason: "protected_assessment_phase",
        candidate_formed: false
      };
    }

    // 2. 学生控制权硬门控：学生已显式关闭本知识点主动提醒
    if (studentAuthority && (studentAuthority.is_kp_disabled === true || studentAuthority.proactive_preference === "off")) {
      return {
        action: TIMING_ACTIONS.SILENT,
        reason: "student_disabled_kp_proactivity",
        candidate_formed: false
      };
    }

    // 3. 冷却期硬门控：处于冷却时间窗内
    if (cooldownState && typeof cooldownState.activeUntil === "number" && cooldownState.activeUntil > now) {
      return {
        action: TIMING_ACTIONS.SILENT,
        reason: "cooling_down",
        remaining_cooldown_ms: cooldownState.activeUntil - now,
        candidate_formed: false
      };
    }

    // A verified comparison is an invitation opportunity, not a help-need estimate.
    // All assessment, consent, cooldown and upstream policy guards still apply.
    if(verifiedReflectionOpportunity) {
      if(typeof interruptible_now!=='number'||interruptible_now<this.interruptibilityThreshold)
        return {action:TIMING_ACTIONS.WAIT,reason:'reflection_wait_for_boundary',candidate_formed:true};
      return {action:atBoundary?TIMING_ACTIONS.BOUNDARY:TIMING_ACTIONS.WAIT,reason:atBoundary?'exploration_comparison_boundary':'reflection_wait_for_boundary',candidate_formed:true};
    }
    if (![need_help_now, interruptible_now].every(value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1)) {
      return { action: TIMING_ACTIONS.SILENT, reason: "required_evidence_missing", candidate_formed: false };
    }

    // 4. 困难度未达标
    if (need_help_now < this.helpNeedThreshold) {
      return {
        action: TIMING_ACTIONS.SILENT,
        reason: "help_need_below_threshold",
        candidate_formed: false
      };
    }

    // 候选已形成 (Candidate Formed)
    const candidate_formed = true;

    // 5. 可打断性评估：需要帮助，但当前打断会破坏专注思路
    if (interruptible_now < this.interruptibilityThreshold) {
      return {
        action: TIMING_ACTIONS.WAIT,
        reason: "low_interruptibility_wait_for_boundary",
        candidate_formed
      };
    }

    // 6. 自然边界触发 vs 立即介入
    if (atBoundary) {
      return {
        action: TIMING_ACTIONS.BOUNDARY,
        reason: "natural_task_boundary_reached",
        candidate_formed
      };
    }

    return {
      action: TIMING_ACTIONS.IMMEDIATE,
      reason: "high_need_and_high_interruptibility",
      candidate_formed
    };
  }
}

module.exports = { TimingGate, TIMING_ACTIONS, PROTECTED_PHASES };
