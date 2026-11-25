const source = Object.freeze({
  label: 'OpenStax《微积分》第 1 卷 §2.2 函数的极限',
  url: 'https://openstax.org/books/calculus-volume-1/pages/2-2-the-limit-of-a-function'
});

export const lesson = Object.freeze({
  id: 'function-limits-v1',
  title: '函数值与极限',
  objective: '区分函数在一点的取值与自变量趋近该点时函数的变化趋势。',
  prework: '阅读教材第 2.2 节，用一句话写下“x 越来越接近某点”和“x 等于某点”的区别，再完成准备度练习。',
  source
});

export const questions = {
  practice: {
    id: 'limits-practice',
    prompt: '当 x ≠ 5 时，f(x) = (x² − 6x + 5)/(x − 5)，另规定 f(5) = 1。x 趋近 5 时，f(x) 的极限是多少？',
    choices: [
      { id: 'a', text: '1' },
      { id: 'b', text: '4' },
      { id: 'c', text: '极限不存在' }
    ],
    answer: 'b',
    pointValue: 'a'
  },
  verification: {
    id: 'limits-verification',
    prompt: '当 x ≠ 3 时，g(x) = (x² − 9)/(x − 3)，另规定 g(3) = 7。x 趋近 3 时，g(x) 的极限是多少？',
    choices: [
      { id: 'a', text: '7' },
      { id: 'b', text: '极限不存在' },
      { id: 'c', text: '6' }
    ],
    answer: 'c',
    pointValue: 'a'
  }
};

const hintTexts = [
  '先说说你的依据。你观察的是 x 等于 5 时的取值，还是 x 靠近 5 时的趋势？',
  '极限描述的是靠近某点时函数值的趋势。单独规定的点值可能和这个趋势不同。',
  '先写下题目规定的 f(5)，再观察 x ≠ 5 时的公式。你能把分子因式分解吗？',
  '找出二次式的两个因式。约去分子与分母的公因式前，确认 x ≠ 5。',
  '看看类似的式子 (t² − 1)/(t − 1)。当 t ≠ 1 时，展开分解式 (t − 1)(t + 1)，再约去 t − 1。把同样的步骤用于练习。'
];

export function hintAt(level) {
  return { level, text: hintTexts[level - 1], source };
}
