import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/shell/Logo";
import styles from "./Landing.module.css";

export const metadata: Metadata = {
  title: "PowerMesh — Borrow compute, never the computer",
  description:
    "A permissioned compute mesh for running signed, bounded workloads on community hardware without exposing the provider's machine.",
};

const steps = [
  {
    number: "01",
    title: "Request a capability",
    copy: "Choose a reviewed workload and fixed parameters. No shell, custom command or remote desktop is handed over.",
  },
  {
    number: "02",
    title: "Score the risk",
    copy: "The coordinator checks identity, image signature, resource limits, network policy and input constraints before matching.",
  },
  {
    number: "03",
    title: "Provider approves",
    copy: "The device owner sees exactly what will run, what it can access and how much compute it may consume.",
  },
  {
    number: "04",
    title: "Return proof, not access",
    copy: "Only validated output and signed execution events return. The requester never receives a path into the provider device.",
  },
];

const statusRows = [
  ["Coordinator API", "LIVE", "Auth gates, rate limits and bounded job contracts"],
  ["Workload identity", "LIVE", "Signed manifest and immutable image digest"],
  ["Artifact transport", "NEXT", "Typed input upload and validated output return"],
  ["Provider runtime", "NEXT", "Rootless Docker with gVisor on provider hardware"],
  ["Controlled egress", "NEXT", "Allowlisted proxy, DNS policy and audit trail"],
] as const;

export default function Home() {
  return (
    <main className={styles.page}>
      <a className={styles.skip} href="#main-content">
        Skip to content
      </a>

      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="PowerMesh landing page">
          <Logo />
        </Link>
        <nav className={styles.nav} aria-label="Landing page">
          <a href="#how-it-works">How it works</a>
          <a href="#trust">Trust model</a>
          <a href="#build-status">Build status</a>
        </nav>
        <Link href="/jobs" className={styles.headerCta}>
          Open console <span aria-hidden="true">↗</span>
        </Link>
      </header>

      <div id="main-content">
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroCopy}>
            <p className={styles.kicker}>
              <span className={styles.liveDot} aria-hidden="true" />
              DISTRIBUTED COMPUTE / BOUNDED BY POLICY
            </p>
            <h1 id="hero-title">
              Borrow compute.
              <br />
              <span className={styles.heroAccent}>Never the computer.</span>
            </h1>
            <p className={styles.heroLead}>
              PowerMesh lets people share spare compute as a narrow, permissioned capability. Every
              workload is signed, resource-limited and approved before it reaches provider hardware.
            </p>
            <div className={styles.heroActions}>
              <Link href="/jobs" className={styles.primaryCta}>
                Enter the live demo <span aria-hidden="true">→</span>
              </Link>
              <a href="#trust" className={styles.secondaryCta}>
                Inspect the boundary
              </a>
            </div>
          </div>

          <figure className={styles.meshPanel} aria-label="PowerMesh execution path">
            <div className={styles.panelTopline}>
              <span>PM / EXECUTION PATH</span>
              <span className={styles.panelState}>COORDINATOR ONLINE</span>
            </div>
            <ol className={styles.meshFlow}>
              <li>
                <span className={styles.flowIndex}>01</span>
                <div>
                  <strong>REQUESTER</strong>
                  <small>chooses approved workload</small>
                </div>
                <span className={styles.flowSignal}>OUT</span>
              </li>
              <li>
                <span className={styles.flowIndex}>02</span>
                <div>
                  <strong>POLICY GATE</strong>
                  <small>auth · risk · digest · limits</small>
                </div>
                <span className={styles.flowSignal}>PASS</span>
              </li>
              <li>
                <span className={styles.flowIndex}>03</span>
                <div>
                  <strong>PROVIDER</strong>
                  <small>reviews and approves offer</small>
                </div>
                <span className={styles.flowSignal}>HOLD</span>
              </li>
              <li>
                <span className={styles.flowIndex}>04</span>
                <div>
                  <strong>SANDBOX</strong>
                  <small>bounded runtime · typed output</small>
                </div>
                <span className={styles.flowSignal}>RUN</span>
              </li>
            </ol>
            <div className={styles.digestLine}>
              <span>IMAGE DIGEST</span>
              <code>sha256:cb059e10…5801</code>
            </div>
          </figure>

          <ul className={styles.heroRail} aria-label="Core guarantees">
            <li>OFFLINE BY DEFAULT</li>
            <li>PROVIDER APPROVAL</li>
            <li>DIGEST PINNED</li>
            <li>OUTPUT VALIDATED</li>
          </ul>
        </section>

        <section className={styles.positioning} aria-label="What PowerMesh is">
          <p className={styles.sectionLabel}>01 / THE IDEA</p>
          <div className={styles.positioningGrid}>
            <h2>Compute sharing without surrendering control.</h2>
            <div className={styles.positioningCopy}>
              <p>
                Today, sharing compute usually means trusting a stranger with a machine or trusting
                a machine with arbitrary code. PowerMesh changes the unit of exchange: a reviewed
                capability with a hard boundary.
              </p>
              <div className={styles.notList}>
                <span>NOT REMOTE DESKTOP</span>
                <span>NOT A MINING POOL</span>
                <span>NOT ARBITRARY CODE EXECUTION</span>
              </div>
            </div>
          </div>
        </section>

        <section id="how-it-works" className={styles.process} aria-labelledby="process-title">
          <div className={styles.sectionHead}>
            <p className={styles.sectionLabel}>02 / HOW IT WORKS</p>
            <h2 id="process-title">One bounded job. Four explicit gates.</h2>
          </div>
          <ol className={styles.steps}>
            {steps.map((step) => (
              <li key={step.number}>
                <span className={styles.stepNumber}>{step.number}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.copy}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section id="trust" className={styles.trust} aria-labelledby="trust-title">
          <div className={styles.trustIntro}>
            <p className={styles.sectionLabel}>03 / TRUST MODEL</p>
            <h2 id="trust-title">The boundary is the product.</h2>
            <p>
              A container alone is not a security promise. PowerMesh layers identity, policy and
              runtime isolation so every participant can verify what is allowed before execution
              begins.
            </p>
          </div>

          <figure className={styles.boundary} aria-label="Layered security boundary">
            <div className={styles.boundaryTop}>
              <span>REQUESTER INPUT</span>
              <span>UNTRUSTED</span>
            </div>
            <div className={styles.boundaryLayers}>
              <div>
                <span>GATE 01</span>
                <strong>Identity + authorization</strong>
                <small>Who may request which capability</small>
              </div>
              <div>
                <span>GATE 02</span>
                <strong>Signed workload policy</strong>
                <small>Exact image, schema and limits</small>
              </div>
              <div>
                <span>GATE 03</span>
                <strong>Provider consent</strong>
                <small>Human-visible approval before claim</small>
              </div>
              <div>
                <span>GATE 04</span>
                <strong>Isolated execution</strong>
                <small>Rootless runtime, restricted syscalls, quotas</small>
              </div>
              <div>
                <span>GATE 05</span>
                <strong>Validated output</strong>
                <small>Typed artifacts only, with audit evidence</small>
              </div>
            </div>
            <div className={styles.boundaryBottom}>
              <span>PROVIDER DEVICE</span>
              <span>NEVER EXPOSED</span>
            </div>
          </figure>
        </section>

        <section id="build-status" className={styles.status} aria-labelledby="status-title">
          <div className={styles.statusHeading}>
            <div>
              <p className={styles.sectionLabel}>04 / BUILD STATUS</p>
              <h2 id="status-title">Built in public. Labeled honestly.</h2>
            </div>
            <p>
              The coordinator is live today. Hardware execution stays gated until the stronger
              provider runtime and artifact path are ready.
            </p>
          </div>

          <table className={styles.statusTable}>
            <caption className="pm-visually-hidden">PowerMesh implementation status</caption>
            <tbody>
              {statusRows.map(([system, state, detail]) => (
                <tr className={styles.statusRow} key={system}>
                  <th scope="row">{system}</th>
                  <td>
                    <span className={state === "LIVE" ? styles.liveBadge : styles.nextBadge}>
                      {state}
                    </span>
                  </td>
                  <td>{detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className={styles.finalCta} aria-labelledby="final-title">
          <p className={styles.sectionLabel}>READY TO INSPECT</p>
          <h2 id="final-title">See the mesh before it touches a machine.</h2>
          <p>Explore the requester, provider and control-room flows in the live prototype.</p>
          <div className={styles.heroActions}>
            <Link href="/jobs" className={styles.primaryCta}>
              Launch PowerMesh <span aria-hidden="true">→</span>
            </Link>
            <a
              href="https://github.com/kavya-jain14/POWERMESH"
              target="_blank"
              rel="noreferrer"
              className={styles.secondaryCta}
            >
              View source ↗
            </a>
          </div>
        </section>
      </div>

      <footer className={styles.footer}>
        <Logo />
        <p>Share a capability, not a device.</p>
        <span>ANTRIX / 2026</span>
      </footer>
    </main>
  );
}
