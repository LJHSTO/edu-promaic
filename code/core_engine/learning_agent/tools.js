import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { pointContrast } from './contrast.js';
import { expandKnowledge, retrieveKnowledge } from './knowledge.js';

const scope = { courseVersion: z.string().max(60), conceptId: z.string().max(60) };

export const expandConceptTool = tool(expandKnowledge, {
  name: 'expand_course_concept',
  description: '查找当前课程版本中相邻的概念和关系。',
  schema: z.object(scope)
});

export const searchPassagesTool = tool(retrieveKnowledge, {
  name: 'retrieve_course_passages',
  description: '在课程和等级范围内查找已经发布的教学片段。',
  schema: z.object({
    ...scope,
    query: z.string().min(1).max(100),
    limit: z.number().int().min(1).max(5),
    maxLevel: z.number().int().min(1).max(5)
  })
});

export const contrastTool = tool(pointContrast, {
  name: 'compare_point_neighborhood',
  description: '比较单点取值与两侧数值。使用独立于正式题目的示例。',
  schema: z.object({ pointValue: z.number().int().min(-5).max(5) })
});
