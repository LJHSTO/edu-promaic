"use strict";

/**
 * @file evidence-package.js
 * @description D1 学习状态证据包规范
 * 保证事实（可观察数据）与推断（模型估计）强隔离，支持溯源、时间窗与缺失性声明。
 */

/**
 * @typedef {Object} ObservableFacts
 * @property {string} current_kp - 知识点编码，例如 "GH-02-K02"
 * @property {string} event_type - 事件类型，如 "formative_error", "idle_stall"
 * @property {string} [error_detail] - 错误具体语义标签
 * @property {number} timestamp - 事件发生毫秒时间戳
 * @property {string} [source] - 来源标签，如 "courseware_step", "checkpoint"
 * @property {boolean} [includes_hint_influence=false] - 本次操作前是否已显示提示
 */

/**
 * @typedef {Object} InferenceEstimates
 * @property {string} [target_state="unknown"] - 推断出的学生心智误解状态
 * @property {number|null} [need_help_now=null] - 工程评分；缺失不得填零或称为概率
 * @property {number|null} [interruptible_now=null] - 可打断性评分；缺失不得默认可打断
 * @property {number|null} [confidence=null] - 未校准置信评分
 */

function freezeTree(value) {
  if(value && typeof value==="object") {Object.values(value).forEach(freezeTree);Object.freeze(value);}
  return value;
}
function normalizeFacts(facts) {
  if (!isNonemptyText(facts?.current_kp) || !isNonemptyText(facts?.event_type)) {
    throw new TypeError("EvidencePackage: facts.current_kp and facts.event_type are required strings");
  }
  return freezeTree({
    current_kp: String(facts.current_kp),
    event_type: String(facts.event_type),
    error_detail: facts.error_detail ? String(facts.error_detail) : "",
    timestamp: Number.isFinite(facts.timestamp) ? facts.timestamp : null,
    source: String(facts.source || "courseware_event"),
    includes_hint_influence: Boolean(facts.includes_hint_influence),
    observable_features: facts.observable_features ? JSON.parse(JSON.stringify(facts.observable_features)) : null,
    references: Array.isArray(facts.references) ? JSON.parse(JSON.stringify(facts.references)) : []
  });
}

function isNonemptyText(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function normalizeInference(inference) {
  const score = value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
  return Object.freeze({
    target_state: String(inference.target_state || "unknown"),
    need_help_now: score(inference.need_help_now),
    interruptible_now: score(inference.interruptible_now),
    confidence: score(inference.confidence)
  });
}

function normalizeProvenance(provenance) {
  return Object.freeze({
    model_version: String(provenance.model_version || "rule-baseline-v1"),
    evidence_window_seconds: typeof provenance.evidence_window_seconds === "number"
      && Number.isFinite(provenance.evidence_window_seconds) && provenance.evidence_window_seconds >= 0
      ? provenance.evidence_window_seconds : null,
    generated_at: Date.now(),
    calibrated: false,
    score_semantics: "uncalibrated_rule_score"
  });
}

class EvidencePackage {
  /**
   * @param {Object} params
   * @param {ObservableFacts} params.facts
   * @param {InferenceEstimates} [params.inference]
   * @param {string[]} [params.missing] - 声明缺失的事实证据
   * @param {Object} [params.provenance] - 证据溯源元数据
   */
  constructor({ facts, inference = {}, missing = [], provenance = {} } = {}) {
    this.facts = normalizeFacts(facts);
    this.inference = normalizeInference(inference);

    this.missing = Object.freeze([...new Set([
      ...(Array.isArray(missing) ? missing.filter(value => typeof value === "string") : []),
      ...["need_help_now", "interruptible_now", "confidence"].filter(key => this.inference[key] === null),
      ...(this.facts.timestamp === null ? ["timestamp"] : [])
    ])]);

    this.provenance = normalizeProvenance(provenance);

    Object.freeze(this);
  }

  toJSON() {
    return {
      facts: this.facts,
      inference: this.inference,
      missing: this.missing,
      provenance: this.provenance
    };
  }
}

module.exports = { EvidencePackage };
