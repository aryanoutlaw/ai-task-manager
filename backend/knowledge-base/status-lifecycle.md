---
id: status-lifecycle
title: Task status lifecycle
tags: status, lifecycle, workflow, pending, in progress, in_progress, completed, done, reopen, transition
---

# Task status lifecycle

A task moves through three statuses: pending, in_progress and completed.

## Pending

Pending is the starting status for every new task. It means the task is accepted but nobody has started it yet.

## In progress

Move a task to in_progress when you actively start working on it. Keep work in progress small: each person should have at most three tasks in_progress at the same time. If a task is blocked for more than two days, add a note to the description explaining the blocker and mention it at stand-up.

## Completed

Move a task to completed only when the acceptance criteria in the description are met and any related code is merged or deployed. Completed tasks are kept for reporting; prefer completing a task over deleting it.

## Reopening a task

If a completed task turns out to be unfinished, move it back to in_progress and add a short note describing what was missed, instead of creating a duplicate task.
