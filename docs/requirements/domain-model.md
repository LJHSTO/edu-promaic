# Edu ProMAIC 领域模型

## 核心对象

```text
Student
Teacher
Course
CoursePack
KnowledgePoint
LearningTask
LearningEvent
Evidence
Misconception
SupportAction
SupportEpisode
VerificationTask
OutcomeMeasurement
PolicyDecision
AuditRecord
```

## 对象关系

```text
Course
  └── CoursePack
        └── KnowledgePoint
              ├── LearningTask
              ├── Misconception
              ├── SupportAction
              ├── VerificationTask
              └── OutcomeMeasurement

Student
  └── LearningEvent
        └── Evidence
              └── PolicyDecision
                    └── SupportEpisode
                          └── VerificationTask
                                └── OutcomeMeasurement
```
