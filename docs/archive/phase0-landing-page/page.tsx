import { networkModes, riskTiers } from "@powermesh/contracts";

const principles = [
  [
    "01",
    "Consent before compute",
    "A provider sees the exact workload, limits, and network policy before approval.",
  ],
  [
    "02",
    "Capability over device",
    "Requesters ask for bounded compute; they never receive access to the provider machine.",
  ],
  [
    "03",
    "Evidence over claims",
    "Every safety badge must map to an Agent probe, policy decision, and test result.",
  ],
] as const;

export default function Home() {
  return (
    <main>
      <nav aria-label="Primary navigation">
        <a className="brand" href="#top">
          POWER/MESH
        </a>
        <div className="nav-links">
          <a href="#principles">Principles</a>
          <a href="#foundation">Foundation</a>
        </div>
        <span className="phase">PHASE 0</span>
      </nav>

      <section className="hero" id="top">
        <p className="eyebrow">CONSENT-FIRST PEER COMPUTE</p>
        <h1>
          Share a capability.
          <br />
          Never the device.
        </h1>
        <p className="lede">
          PowerMesh turns idle hardware into a controlled compute node with explicit approval,
          deterministic risk policy, and verifiable isolation.
        </p>
        <div className="hero-actions">
          <a className="primary-action" href="#foundation">
            Inspect the foundation
          </a>
          <span>Requester → policy → consent → sandbox → verified result</span>
        </div>
      </section>

      <section className="principles" id="principles" aria-labelledby="principles-title">
        <div className="section-intro">
          <p className="eyebrow">NON-NEGOTIABLES</p>
          <h2 id="principles-title">The trust boundary is the product.</h2>
        </div>
        <div className="principle-list">
          {principles.map(([number, title, copy]) => (
            <article key={number}>
              <span>{number}</span>
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="foundation" id="foundation" aria-labelledby="foundation-title">
        <div>
          <p className="eyebrow">CONTRACTS V0</p>
          <h2 id="foundation-title">Small enough to prove. Strict enough to trust.</h2>
        </div>
        <dl>
          <div>
            <dt>Risk tiers</dt>
            <dd>{riskTiers.join(" / ")}</dd>
          </div>
          <div>
            <dt>Network modes</dt>
            <dd>{networkModes.join(" / ")}</dd>
          </div>
          <div>
            <dt>Default posture</dt>
            <dd>OFFLINE · ROOTLESS · RESOURCE-BOUNDED</dd>
          </div>
        </dl>
      </section>

      <footer>
        <span>POWERMESH / FRESH START</span>
        <span>KAVYA × GARGI</span>
      </footer>
    </main>
  );
}
