---
description: Build this project and publish it on Prototyper for client review
argument-hint: "[what changed, for the client]"
---

Publish this project on Prototyper following the prototyper skill: make sure texts and images carry `data-pt` keys, build, lint, then call the `publish` tool with the build folder. If this folder isn't linked to a Prototyper project yet, infer the project name and client from the conversation and the repo.

Changelog for the client (may be empty for a first version): $ARGUMENTS

Finish with the review link.
