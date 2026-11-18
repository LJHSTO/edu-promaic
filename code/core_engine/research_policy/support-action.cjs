"use strict";

/**
 * @file support-action.js
 * @description D3 教学支持与支架强度契约
 * 区分教学信息深度、行动授权与呈现表面。L0 表示没有支架。
 * L1-L5 必须标明独立任务与复查题。泄露标记是声明，仍需内容审核。
 */

const crypto = require("node:crypto");

const SUPPORT_DEPTHS = Object.freeze(["L0", "L1", "L2", "L3", "L4", "L5"]);

const SUPPORT_FUNCTIONS = Object.freeze([
  "self_explanation",    // L1: 促使自我解释
  "concept_hint",        // L2: 概念线索
  "subgoal_prompt",      // L3: 子目标支架
  "next_step_scaffold",  // L4: 关键步骤建议
  "worked_example_step"  // L5: 局部样例示范
]);

function validateSupport({ depth, functionType, targetKp, contentText, remainingStudentTask, followupCheckId, leaksCurrentAnswer }) {
  if (!SUPPORT_DEPTHS.includes(depth)) {
    throw new TypeError("SupportAction: unknown support depth");
  }
  if (typeof leaksCurrentAnswer !== "boolean") {
    throw new TypeError("SupportAction: leaksCurrentAnswer must be a boolean");
  }
  if (depth === "L0") return;
  if (!SUPPORT_FUNCTIONS.includes(functionType)) {
    throw new TypeError("SupportAction: unknown teaching function");
  }
  const fields = [targetKp, contentText, remainingStudentTask, followupCheckId];
  if (fields.some(value => typeof value !== "string" || !value.trim())) {
    throw new TypeError("SupportAction: target, content, independent task and check ID are required");
  }
  if (["L1", "L2", "L3"].includes(depth) && leaksCurrentAnswer) {
    throw new TypeError("SupportAction: this support depth is forbidden from leaking the current answer");
  }
}

class SupportAction {
  /**
   * @param {Object} params
   * @param {string} params.depth - "L0" ~ "L5"
   * @param {string} params.functionType - 教学功能
   * @param {string} params.targetKp - 知识点 ID
   * @param {string} params.contentText - 实际支架文本
   * @param {string} params.remainingStudentTask - 留给学生独立做的事情
   * @param {string} params.followupCheckId - 对应的支架后独立复查题 ID (用于渐退检验)
   * @param {boolean} [params.leaksCurrentAnswer=false] - 是否泄露答案 (L1-L3 严禁为 true)
   * @param {string} [params.contentVersion="v1.0"]
   */
  constructor({
    depth,
    functionType,
    targetKp,
    contentText,
    remainingStudentTask,
    followupCheckId,
    leaksCurrentAnswer = false,
    contentVersion = "v1.0"
  } = {}) {
    validateSupport({ depth, functionType, targetKp, contentText, remainingStudentTask, followupCheckId, leaksCurrentAnswer });
    const isSilent = depth === "L0";
    this.action_id = crypto.randomUUID();
    this.support_depth = depth;
    this.support_function = isSilent ? null : functionType;
    this.target_kp = String(targetKp || "");
    this.content_text = isSilent ? "" : String(contentText);
    this.student_must_still_do = isSilent ? "" : String(remainingStudentTask);
    this.followup_check_id = isSilent ? null : String(followupCheckId);
    this.leaks_current_answer = isSilent ? false : Boolean(leaksCurrentAnswer);
    this.content_version = String(contentVersion);
    this.created_at = Date.now();

    Object.freeze(this);
  }

  toJSON() {
    return {
      action_id: this.action_id,
      support_depth: this.support_depth,
      support_function: this.support_function,
      target_kp: this.target_kp,
      content_text: this.content_text,
      student_must_still_do: this.student_must_still_do,
      followup_check_id: this.followup_check_id,
      leaks_current_answer: this.leaks_current_answer,
      content_version: this.content_version,
      created_at: this.created_at
    };
  }
}

module.exports = { SupportAction, SUPPORT_DEPTHS, SUPPORT_FUNCTIONS };
