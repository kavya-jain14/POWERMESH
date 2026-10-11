import { buttonClassName, EmptyState } from "@powermesh/ui";
import Link from "next/link";
import type { Role } from "@/contracts-draft/types";
import { ROLE_LABEL } from "@/lib/copy";

/** 403 surface for role-gated routes (G1 §2). The server API enforces the same rule. */
export function Forbidden({ role, needs }: { role: Role; needs: Role[] }) {
  return (
    <EmptyState
      icon="lock"
      title="You don't have access to this"
      action={
        <Link href="/" className={buttonClassName("secondary")}>
          Go to your home screen
        </Link>
      }
    >
      This screen is for {needs.map((r) => ROLE_LABEL[r].toLowerCase()).join(" and ")}s. You're
      viewing PowerMesh as a {ROLE_LABEL[role].toLowerCase()}.
    </EmptyState>
  );
}
