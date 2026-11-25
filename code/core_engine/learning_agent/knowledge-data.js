export const courseVersion = 'function-limits-v1';
export const focusConceptId = 'limit-vs-point-value';

const textbook = 'https://openstax.org/books/calculus-volume-1/pages/';
const limits = {
  label: 'OpenStax《微积分》第 1 卷 §2.2 函数的极限',
  url: textbook + '2-2-the-limit-of-a-function'
};
const limitLaws = {
  label: 'OpenStax《微积分》第 1 卷 §2.3 极限定律',
  url: textbook + '2-3-the-limit-laws'
};
const continuity = {
  label: 'OpenStax《微积分》第 1 卷 §2.4 连续性',
  url: textbook + '2-4-continuity'
};

export const conceptLabels = new Map([
  [focusConceptId, '函数值与极限'],
  ['sided-limits', '左右极限'],
  ['equivalent-nearby-expressions', '邻域内等价的表达式'],
  ['continuity', '一点处的连续性'],
  ['removable-discontinuity', '可去间断']
]);

export const conceptRelations = [
  [focusConceptId, 'sided-limits', 'checked-from-both-sides'],
  [focusConceptId, 'equivalent-nearby-expressions', 'computed-in-neighborhood'],
  [focusConceptId, 'continuity', 'compared-for-continuity'],
  ['continuity', 'removable-discontinuity', 'extended-at-a-point']
];

function passage({ key, conceptId, level, terms, text, source, section }) {
  return {
    id: `${courseVersion}/${key}`,
    conceptId, level, terms, text,
    citation: { ...source, id: `${courseVersion}/${key}`, courseVersion, section }
  };
}

export const passages = [
  passage({
    key: 'compare-observations', conceptId: focusConceptId, level: 1,
    terms: ['观察依据', '自我解释', '怎样观察', '从哪里看', '点上还是附近'],
    text: '说说你的判断依据。你观察的是目标点上的取值，还是自变量靠近该点时的变化？',
    source: limits, section: '直观地定义函数的极限'
  }),
  passage({
    key: 'limit-versus-value', conceptId: focusConceptId, level: 2,
    terms: ['区分点值', '附近趋势', '点值', '函数值', '趋近', 'point value'],
    text: '把点上的取值与点附近的变化分开看。只改动目标点上的取值，其余点保持原样，附近的变化趋势就保持原样。',
    source: limits, section: '直观地定义函数的极限'
  }),
  passage({
    key: 'punctured-neighborhood', conceptId: focusConceptId, level: 3,
    terms: ['取值条件', '去心邻域', '非零邻域', '点外', '不等于目标点', '空心点', '实心点'],
    text: '从目标点的两侧各选一个靠近但不等于目标点的自变量。先判断这些值分别适用哪一条函数规则，再比较点附近的变化。',
    source: limits, section: '利用数值表和图像估计极限'
  }),
  passage({
    key: 'two-sided-criterion', conceptId: 'sided-limits', level: 2,
    terms: ['左右极限', '单侧极限', '双侧极限', '两边趋近', '一侧趋近', 'one sided limit'],
    text: '分别从左侧和右侧考察变化趋势。两侧极限都存在且相等时，该公共值就是双侧极限。',
    source: limits, section: '单侧极限与双侧极限的关系'
  }),
  passage({
    key: 'nearby-table', conceptId: 'sided-limits', level: 3,
    terms: ['数值表', '列表估计', '左边列表', '右边列表', '抽样'],
    text: '可以列两列从不同方向靠近目标点的自变量，再比较对应函数值是否靠近同一个数。有限个样本有助于判断趋势，证明还需依据函数关系。',
    source: limits, section: '单侧极限的数值表示'
  }),
  passage({
    key: 'nearby-domain-check', conceptId: 'equivalent-nearby-expressions', level: 3,
    terms: ['取值条件', '等价条件', '邻域内的式子'],
    text: '把原式可以使用的自变量范围写在旁边。靠近目标点时，可以使用在这些自变量上取值相同的表达式来比较趋势。',
    source: limitLaws, section: '因式分解与约分求极限'
  }),
  passage({
    key: 'factor-and-cancel', conceptId: 'equivalent-nearby-expressions', level: 4,
    terms: ['因式分解', '约去公因式', '公因式', '分母不为零', '因子约分', '平方差', 'factoring', 'canceling'],
    text: '先把分子和分母分解成因式，在分母不为零的范围内约去共同因子。写出等价式成立的条件，再用它研究点附近的趋势。',
    source: limitLaws, section: '因式分解与约分求极限'
  }),
  passage({
    key: 'nearby-equivalence-example', conceptId: 'equivalent-nearby-expressions', level: 5,
    terms: ['类比例子', '类似例题', '类比', '其他例题', '换一道题', 'worked example'],
    text: '看一个不同的例子。t ≠ 8 时，(t−8)(t+3)/(t−8) 等于 t+3。研究 t 趋近 8 时的变化，可以使用只在点附近成立的等价式。回到你的题，先写下约分的取值条件。',
    source: limitLaws, section: '因式分解与约分求极限'
  }),
  passage({
    key: 'continuity-criteria', conceptId: 'continuity', level: 2,
    terms: ['连续性', '连续条件', '判断连续', '在一点连续', '连续三条件', 'continuity'],
    text: '判断一点处的连续性时，依次检查函数在该点是否有定义、极限是否存在，以及点值是否等于极限。',
    source: continuity, section: '一点处连续的定义'
  }),
  passage({
    key: 'removable-extension', conceptId: 'removable-discontinuity', level: 3,
    terms: ['可去间断', '连续延拓', '补点', '怎样填洞', 'removable discontinuity'],
    text: '如果某点的有限极限存在，但函数在该点没有定义或点值与极限不同，把该点的取值设为这个极限便能补成连续函数。',
    source: continuity, section: '间断点与连续延拓'
  })
];
