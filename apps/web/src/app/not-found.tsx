import { buttonClassName, EmptyState } from "@powermesh/ui";
import Link from "next/link";

export default function NotFound() {
  return (
    <EmptyState
      icon="alert"
      title="We couldn't find that page"
      action={
        <Link href="/" className={buttonClassName("secondary")}>
          Go to your home screen
        </Link>
      }
    >
      The link may be old, or it may point to something your role can't see.
    </EmptyState>
  );
}
