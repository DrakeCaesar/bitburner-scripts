import { NS } from "@ns"

/** Outcome of checking a single goal against current game state. */
export interface GoalCheckResult {
  complete: boolean
  /** Human-readable progress or blocker (shown in the tail UI). */
  detail: string
  /** Cannot proceed until an external condition changes (e.g. missing faction invite). */
  blocked?: boolean
}

export type GoalStatus = "complete" | "active" | "blocked" | "pending"

export interface GoalDefinition {
  id: string
  label: string
  /** When omitted, complete iff every child is complete. */
  check?: (ns: NS) => GoalCheckResult
  children?: GoalDefinition[]
}

export interface EvaluatedGoal {
  id: string
  label: string
  status: GoalStatus
  detail: string
  children: EvaluatedGoal[]
}

function evaluateNode(ns: NS, goal: GoalDefinition): EvaluatedGoal {
  const children = (goal.children ?? []).map((child) => evaluateNode(ns, child))
  const own = goal.check?.(ns) ?? compositeFromChildren(children)

  let status: GoalStatus
  if (own.complete) {
    status = "complete"
  } else if (own.blocked) {
    status = "blocked"
  } else if (children.some((child) => child.status !== "complete")) {
    status = "pending"
  } else {
    status = "pending"
  }

  return {
    id: goal.id,
    label: goal.label,
    status,
    detail: own.detail,
    children,
  }
}

function compositeFromChildren(children: EvaluatedGoal[]): GoalCheckResult {
  const complete = children.length > 0 && children.every((child) => child.status === "complete")
  if (complete) {
    return { complete: true, detail: "done" }
  }
  const incomplete = children.filter((child) => child.status !== "complete")
  return {
    complete: false,
    detail: `${incomplete.length} sub-goal${incomplete.length === 1 ? "" : "s"} remaining`,
  }
}

/** Mark the leftmost incomplete leaf (depth-first) as active. */
function markActiveGoal(root: EvaluatedGoal): void {
  let marked = false

  function walk(node: EvaluatedGoal): void {
    if (marked) return

    if (node.status === "complete") return

    if (node.children.length === 0) {
      node.status = node.status === "blocked" ? "blocked" : "active"
      marked = true
      return
    }

    for (const child of node.children) {
      walk(child)
      if (marked) return
    }

    if (node.status !== "blocked") {
      node.status = "active"
    }
    marked = true
  }

  walk(root)
}

export function evaluateGoalTree(ns: NS, root: GoalDefinition): EvaluatedGoal {
  const evaluated = evaluateNode(ns, root)
  markActiveGoal(evaluated)
  return evaluated
}

export function flattenGoalLines(
  goal: EvaluatedGoal,
  depth = 0
): Array<{ depth: number; label: string; status: GoalStatus; detail: string }> {
  const lines = [{ depth, label: goal.label, status: goal.status, detail: goal.detail }]
  for (const child of goal.children) {
    lines.push(...flattenGoalLines(child, depth + 1))
  }
  return lines
}

export function findActiveGoal(goal: EvaluatedGoal): EvaluatedGoal | null {
  if (goal.status === "active" || goal.status === "blocked") return goal
  for (const child of goal.children) {
    const found = findActiveGoal(child)
    if (found) return found
  }
  return null
}
