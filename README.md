DoQuestionViewStandalone

This folder contains a standalone copy of the DoQuestionView (student-facing) app extracted from the main project.

Files:
- index.html — standalone HTML
- css/* — styles (copied)
- js/* — minimal JS (config, github stub, student_app)

How to use:
1. Open `index.html` in a browser.
2. The view will attempt to connect to the hardcoded public repo `Revampes/ChemQuestion` to load topics. If offline, use the browser console to inspect and inject `repoInfo` or mock `TOPICS`.

Notes:
- This is a minimal extraction for convenience. Some manager/upload features are stubs.
