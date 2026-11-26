export function pointContrast({ pointValue }) {
  const endpoint = 0;
  const nearby = [-0.1, 0.1, -0.01, 0.01].map(x => [x, 10 + x]);
  return {
    section: '比较一个独立的小例子',
    endpoint,
    pointValue,
    nearby,
    text: `规定 q(0) = ${pointValue}。q(−0.01) = ${nearby[2][1]}，q(0.01) = ${nearby[3][1]}。分别说说点上的取值与两侧数值的趋势。`
  };
}
