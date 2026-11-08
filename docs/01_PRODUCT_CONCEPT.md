|  |
| --- |

COURSEFLOW

Product Concept &
Functional Specification

Your academic navigation system

| Moodle shows students the files. CourseFlow shows them the plan. CourseFlow turns fragmented LMS content into a verified map of what to learn, what to do, where to find it, and when it is due — without writing or summarising the coursework for the student. |
| --- |

Working document • October 2026

Purpose: a single source of truth for the product idea, user experience, functional scope, and differentiation.

# Contents

1.  Executive Summary

2.  The Problem

3.  Product Positioning and Principles

4.  Target User Experience

5.  University Connection and Onboarding

6.  Global University Workspace

7.  Individual Course Experience

8.  Core Intelligence Layer

9.  Study Planning and Progress

10.  Evidence, Trust and Conflict Handling

11.  Changes and Continuous Synchronisation

12.  Functional Scope by Screen

13.  Conceptual Data Model

14.  What CourseFlow Deliberately Does Not Do

15.  Differentiation and Product Moat

16.  MVP and Expansion Path

17.  Success Criteria

18.  Core Product Story

# 1. Executive Summary

CourseFlow is an academic navigation system that sits between a university LMS and the student. It does not replace Moodle, Canvas, Blackboard, Brightspace or another LMS; it reorganises the information the student already has access to into a clear, trustworthy academic workspace.

A student connects their university account once. CourseFlow discovers their active courses, reads the available course pages and documents, and reconstructs the academic structure hidden across the LMS: topics, assessments, deadlines, requirements, prerequisite actions, relevant learning resources, and recent changes.

| The five questions CourseFlow should always answer 1) What do I need to learn? 2) Where exactly do I learn it? 3) What do I need to do? 4) When do I need to do it? 5) How do you know? |
| --- |

The core philosophy is deliberately different from typical AI study assistants. CourseFlow does not write assignments, generate coursework answers, summarise away the lecture, or replace the student’s learning. It organises the university’s own material and makes the academic path visible.

# 2. The Problem

University learning environments contain the information students need, but the information is often fragmented rather than operationally structured. A student may have to inspect Moodle sections, slide decks, handbooks, announcements, assignment briefs and workshop documents to understand a single obligation.

- Deadlines may be present in one place while prerequisite actions are hidden in another.

- An assignment brief may state what must be done without clearly pointing to the lectures that teach each requirement.

- Important administrative actions — such as meeting a supervisor, obtaining approval, or completing an ethics form — may not appear as separate Moodle assignments.

- New files, changed deadlines and updated documents can appear after the student last checked the course.

- Students must manually reconstruct the relationship between course topics, assessment criteria, required actions and dates.

| Illustrative failure case A student knows that a Project Specification must be submitted, but misses a sentence in the Dissertation Handbook stating that the project plan must first be reviewed with the supervisor. The information existed; the problem was that it was not surfaced as an explicit action. |
| --- |

# 3. Product Positioning and Principles

## 3.1 Positioning

Category: Academic Navigation System / Course Intelligence Layer

CourseFlow should not be positioned as an “AI tutor”, “AI homework assistant” or “student planner”. Those categories are crowded and imply functions that CourseFlow intentionally avoids. The product’s role is to reconstruct and maintain the academic execution path across a student’s courses.

## 3.2 Product principles

| Principle | Meaning |
| --- | --- |
| Original learning first | The student reads the university’s lectures, documents and readings. CourseFlow points to the right material rather than replacing it. |
| Evidence before assertion | Important dates, obligations and recommendations should link back to the university source that supports them. |
| AI discovers; the source decides | If sources disagree, CourseFlow displays the conflict instead of pretending certainty. |
| Read-only by default | The system should organise and monitor. It should never submit coursework, change grades or edit university content on the student’s behalf. |
| Simple student-facing language | The interface should say “This needs to happen before your Project Specification”, not “dependency edge detected”. |
| No fake mastery | Opening a file is not learning. Progress is based on explicit student state such as Not started, Studying and Studied. |

# 4. Target User Experience

The ideal experience should feel almost effortless. The student should not need to understand APIs, tokens, browser extensions, document parsing or AI configuration.

| Target onboarding experience Connect university → sign in through normal university authentication → select active courses → CourseFlow builds the workspace → student sees what needs attention across university. |
| --- |

Once connected, CourseFlow becomes a daily navigation layer over the LMS. The student can use the global workspace for cross-course priorities and then enter any individual course for a deeper view.

# 5. University Connection and Onboarding

## 5.1 Connect the university, not individual files

The preferred production flow is account-level connection. The student signs in to the university/LMS using the university’s normal authentication flow. CourseFlow then discovers courses that the student can already access.

| Step | Stage | Student experience |
| --- | --- | --- |
| 1 | Connect University | Student selects University of Portsmouth (initial MVP) and chooses Continue with university account. |
| 2 | University authentication | Student completes the existing university SSO/MFA flow. CourseFlow should never collect the password directly. |
| 3 | Course discovery | CourseFlow lists enrolled courses and distinguishes academic courses from optional/administrative spaces. |
| 4 | Course selection | Student chooses which active courses to organise. |
| 5 | Initial import | CourseFlow processes the selected course pages, resources, assessments, documents and announcements. |
| 6 | Workspace ready | The global academic workspace opens with cross-course priorities and links into each course. |

## 5.2 Initial MVP scope

The first real version can intentionally support only the University of Portsmouth Moodle environment. CourseFlow should still be architected around an LMS connector boundary so that additional universities and LMS platforms can be added later without redesigning the product experience.

# 6. Global University Workspace

The global workspace is the student’s top-level view across all active courses. It should answer what matters now without forcing the student to open every course separately.

| Workspace area | Purpose |
| --- | --- |
| Home | Urgent items, today’s actions, course cards and recent changes across the university workspace. |
| My Courses | All active courses with progress, next assessment, attention state and recent updates. |
| Study Plan | A single chronological plan combining tasks from every course. |
| Assessments | All upcoming and completed assessments with course context, readiness and warnings. |
| Requirements | Academic obligations across courses, including items not represented as LMS assignments. |
| Changes | A chronological feed of new material, deadline changes, announcements, updated documents and newly discovered requirements. |

## 6.1 Global Home

- Lead with the two or three most important items requiring attention — not analytics.

- Show Today as a short list of realistic actions with estimated time and a reason for each task.

- Show course cards with individual progress rather than inventing a single “university completion percentage”.

- Show recent changes compactly to explain why the student should return regularly.

# 7. Individual Course Experience

Entering a course changes the navigation context. The student sees a course-specific workspace while retaining a clear route back to All Courses.

| Course area | Purpose |
| --- | --- |
| Overview | Immediate actions, course progress, next recommendation and upcoming timeline. |
| Course Map | The course reconstructed into coherent topics with original resources and assessment links. |
| Assessments | Assessment list with deadline, weighting, readiness, requirements and linked learning resources. |
| Study Plan | Actions relevant only to this course. |
| Requirements | Mandatory/recommended obligations and dependencies within the course. |
| Changes | New or changed content related only to the selected course. |

## 7.1 Course Map

The Course Map is not a summary of lectures. It is a navigation structure. Each topic groups the university’s original materials and shows where the topic is used.

| Example topic Model Evaluation — 75% studied • Lecture 6 • Lab 6 • Reading • Workshop 6 • Used in: Model Evaluation Assignment and Final Applied ML Project. |
| --- |

# 8. Core Intelligence Layer

The product’s defensible value is not merely importing an LMS. It is reconstructing the relationships hidden across heterogeneous academic content. CourseFlow should build several connected structures from the source material.

| Structure | What it represents |
| --- | --- |
| Course Knowledge Map | Topics and the original lectures, labs, readings and workshops that belong to each topic. |
| Assessment Requirement Map | Each assessment decomposed into explicit criteria/requirements. |
| Assignment Knowledge Map | Each assessment requirement mapped to exact relevant university materials: lecture, slide range, reading section, lab task or workshop. |
| Obligation Graph | Required academic actions such as supervisor reviews, ethics forms, approvals and formative submissions. |
| Dependency Graph | Ordering constraints such as Supervisor Review → Project Specification → Project Approval → Begin Data Collection. |
| Evidence Graph | Every extracted deadline, obligation and mapping linked to its supporting source and location. |
| Change Graph | New or modified source material connected to the objects it affects. |

## 8.1 Assignment Knowledge Map

This is a central learning feature. CourseFlow should break an assessment into requirements and point the student to the exact material needed to understand each requirement. It should not generate the assessed answer.

| Example Requirement: “Discuss class imbalance and justify the selected evaluation metric.” → Lecture 7 — Class Imbalance, slides 4–19 → Workshop 7, Exercise 2. Status: Not studied. |
| --- |

## 8.2 Hidden obligation discovery

CourseFlow should treat academic obligations as first-class objects. The most valuable discoveries are often actions that exist in prose but are not represented as tasks in the LMS.

| High-value discovery pattern “CourseFlow found something easy to miss: Supervisor review required before Project Specification. Source: Dissertation Handbook, page 18.” |
| --- |

# 9. Study Planning and Progress

## 9.1 Global Study Plan

The global Study Plan combines actions across all selected courses into one realistic sequence. It should prioritise near deadlines, incomplete prerequisites, unstudied material relevant to upcoming assessments, mandatory requirements and meaningful changes detected in the LMS.

| Every task must answer “why now?” Study Lecture 7 — Class Imbalance • 40 min • Needed for Model Evaluation Assignment due in 11 days. Review Dissertation Handbook §4.3 • 15 min • Project Specification due in 4 days. Prepare supervisor questions • 20 min • Supervisor review required before Project Specification. |
| --- |

## 9.2 Progress

Progress should remain intentionally transparent. The first version does not need an opaque “AI mastery” score. A simple state model is enough:

- Not started = no progress credit.

- Studying = partial progress credit.

- Studied = complete for navigation purposes.

Assessment readiness can be derived from the study state of material mapped to assessment requirements, plus prerequisite obligation state. The UI should explain the readiness breakdown rather than presenting an unexplained percentage.

# 10. Evidence, Trust and Conflict Handling

Trust is a core product requirement because a wrong deadline or invented prerequisite can directly harm a student. Every consequential item should be inspectable.

- Deadline → original assignment page / handbook / announcement.

- Academic obligation → source document + page/section + supporting excerpt.

- Recommended learning material → exact lecture/slides/pages and the assessment requirement it supports.

- Changed item → old value, new value and source of the update.

| Conflict behaviour If the Moodle assignment page says 31 October 23:59 and the Assessment Handbook says 31 October 16:00, CourseFlow should display a deadline conflict and ask the student to verify it. It must not silently choose one source. |
| --- |

# 11. Changes and Continuous Synchronisation

CourseFlow should become useful repeatedly, not only during initial import. After the first full course analysis, later synchronisations should focus on new and changed content rather than reprocessing everything unnecessarily.

| Change type | What the student sees |
| --- | --- |
| New material | A new lecture, lab, reading or document is uploaded. |
| Deadline changed | An assessment or event date changes. |
| New requirement | A newly uploaded/updated document introduces an academic action. |
| Announcement | Office hours, room changes, workshop updates or other course information. |
| Document updated | An existing handbook/brief changes and may affect extracted requirements. |

The Changes view is important for retention: it gives the student a concrete reason to open CourseFlow instead of manually checking every Moodle course.

# 12. Functional Scope by Screen

| Screen | Key functionality |
| --- | --- |
| Global Home | Attention cards; Today; course cards; recent changes; cross-course context. |
| My Courses | Course list; progress; next assessment; warnings; add/remove courses. |
| Global Study Plan | Cross-course chronological tasks; reason; duration; course; source; completion state. |
| Global Assessments | All assessments; filters; deadlines; weights; readiness; warnings; course context. |
| Global Requirements | All obligations; mandatory/recommended; found-by-CourseFlow; dependencies; source; completion state. |
| Global Changes | Cross-course updates with type, course, time, source and affected object. |
| Course Overview | Primary action; course progress; recommended next material/action; timeline. |
| Course Map | Topics; original materials; study state; “used in” assessment relationships. |
| Course Assessments | Assessment cards and deep Assessment Knowledge Map. |
| Course Requirements | Course-level obligations and compact dependency chains. |
| Source Viewer | Source title; document type; page/slide/section; relevant excerpt; link to original. |
| Search | Navigation search across courses, topics, resources, requirements and assessments. No chatbot. |
| Notifications | Deadlines, incomplete prerequisites, changed content and conflicts; always with course context. |
| Settings | Connected institution, LMS, active courses, read-only permissions, sync status and disconnect/manage controls. |

# 13. Conceptual Data Model

The exact implementation can evolve, but the product becomes much easier to reason about if it has explicit domain objects instead of treating the whole course as unstructured AI text.

| Object | Meaning |
| --- | --- |
| Institution | University identity and LMS connection. |
| Course | One active module/course. |
| Topic | A reconstructed learning topic within a course. |
| Resource | Lecture, lab, reading, workshop, handbook, announcement or other original item. |
| SourceLocation | Exact page, slide, section or timestamp that supports a claim. |
| Assessment | An assessed deliverable or milestone. |
| AssessmentRequirement | One criterion/action extracted from an assessment brief or rubric. |
| Obligation | A required or recommended academic action outside (or alongside) an assessment. |
| Dependency | “A must happen before B” relationship. |
| StudyState | Not started / Studying / Studied. |
| StudyTask | An actionable item in the student plan with reason and priority context. |
| ChangeEvent | A detected change in the LMS or source material. |
| Conflict | Two or more sources that disagree on a consequential fact. |

# 14. What CourseFlow Deliberately Does Not Do

Product focus is protected by explicit non-goals. These features may be popular in EdTech, but they would blur CourseFlow’s identity and weaken the core experience.

- No essay or coursework writing.

- No “generate my answer” function.

- No generic AI chatbot as the centre of the product.

- No lecture summarisation as a core feature.

- No flashcard factory, generic quiz generator or gamification layer.

- No assumption that opening a document equals learning it.

- No autonomous submission or editing of university systems.

- No silent resolution of conflicting deadlines or requirements.

| Product promise No shortcuts. No generated assignments. CourseFlow helps students find the right material so they can learn it themselves. |
| --- |

# 15. Differentiation and Product Moat

Individual features such as deadlines, calendars, notifications and LMS sync already exist widely. CourseFlow should not claim uniqueness based on those functions. Its differentiation comes from the connected academic model and the resulting user experience.

| Differentiator | Why it matters |
| --- | --- |
| Hidden obligation extraction | Finding actions buried in prose that the LMS does not represent as tasks. |
| Obligation dependency reconstruction | Understanding that one academic action must happen before another. |
| Assignment-to-material mapping | Connecting each assignment criterion to exact original teaching material. |
| Verified evidence layer | Making every important conclusion traceable back to an original source. |
| Cross-source conflict detection | Surfacing disagreement instead of guessing. |
| Cross-course execution plan | Prioritising the student’s real workload across all courses with an explanation for every task. |
| Continuous change propagation | Understanding that a changed document or deadline affects requirements, readiness and the study plan. |

Over time the defensible asset is not a particular LLM. It is the structured relationship between Course Graph + Assessment Graph + Obligation Graph + Evidence Graph + Student State + Change History.

# 16. MVP and Expansion Path

## 16.1 First working product

- Institution: University of Portsmouth only.

- LMS: Moodle only.

- Read-only connection and course discovery.

- Student chooses active courses.

- Core source types: Moodle pages, assignments, announcements, PDF, PowerPoint and Word documents where practical.

- Course Map, assessments, obligations, sources, assignment-to-material mapping, global Study Plan and Changes.

- No payments required for the initial beta; focus on real usage and trust.

## 16.2 Expansion path

| Phase | Focus |
| --- | --- |
| Phase 1 | One student / one or two real Portsmouth courses; validate extraction accuracy. |
| Phase 2 | Free Portsmouth beta; 10–100 students; improve reliability and UX. |
| Phase 3 | Generalise the Moodle connector across more institutions. |
| Phase 4 | Add Canvas / Brightspace / Blackboard / Google Classroom based on demand. |
| Phase 5 | Optional calendar integrations and university-level B2B integration. |
| Phase 6 | Institutional deployment, governance and scale. |

# 17. Success Criteria

The first version should be judged by whether it makes university work meaningfully clearer, not by the number of AI features.

| Signal | Question |
| --- | --- |
| Import completion | Can a student connect and create a usable workspace without technical setup? |
| Source accuracy | Do deadlines, obligations and mappings point to the correct original evidence? |
| Missed-item value | Does CourseFlow discover important actions the student had not noticed? |
| Return behaviour | Do students return weekly because CourseFlow is easier than checking Moodle manually? |
| Multi-course adoption | After importing one course, do users add the rest of their active courses? |
| Study-plan usefulness | Do students complete or follow tasks suggested by the global plan? |
| Trust | Would students rely on CourseFlow for academic organisation while still checking sources when conflicts are flagged? |

# 18. Core Product Story

| One-sentence pitch CourseFlow turns a fragmented university LMS into a verified map of what a student needs to learn, what they need to do, where the relevant material is, and what happens next. |
| --- |

The strongest demo story begins with a familiar student problem: an important requirement existed, but it was buried in a handbook and never appeared as a clear task. CourseFlow connects the university, discovers the courses, surfaces that hidden requirement with evidence, shows its dependency on an upcoming submission, maps the assessment to the exact teaching material, and updates the student’s cross-course plan accordingly.

| Desired reaction “Why doesn’t Moodle already work like this?” |
| --- |

Product identity in one line: Moodle stores the information. CourseFlow reconstructs the academic path hidden inside it.

— End of specification —
