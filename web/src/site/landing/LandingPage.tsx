// The SANT landing (sprint 9 T5, Field Notes): the hero, then the scroll story from T1's content spec
// (§3): the problem → how SANT works → proof → bring your robot → Nemotron → try it, and the power-on
// into the app. Copy and the sources of its numbers live in copy.ts.
import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import PinchSheet from "../../landing/pinchSheet/PinchSheet";
import { Badge, Button, CountUpTiles, ResultBars, SectionHeader, StoryShell, useMotion, usePowerOn } from "../../sant";
import replayFrame from "./assets/replay-frame.png";
import { REPO, RECORD_ROUTE, hero, how, nav, nemotron, problem, proof, robot, tryIt } from "./copy";
import { HeroCanvas } from "./hero/HeroCanvas";
import { DotMatrix } from "./matrix/DotMatrix";
import "./landing.css";

function Source({ children }: { children: ReactNode }) {
  return <span className="sl-source">Source: {children}</span>;
}

export function LandingPage() {
  const powerOn = usePowerOn();
  const { reduced } = useMotion();
  const { hash } = useLocation();
  const howRef = useRef<HTMLElement>(null);
  const heroCopy = useRef<HTMLDivElement>(null);
  const record = (e: MouseEvent<HTMLElement>) => powerOn.start(RECORD_ROUTE, e.currentTarget);

  // The nav's "How it works" is /site#how; the router doesn't scroll to hashes on its own.
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
  }, [hash, reduced]);

  return (
    <StoryShell home="/site" links={nav.links} cta={nav.cta} className="sl-shell">
      <section className="sl-hero" aria-labelledby="sl-hero-title">
        <HeroCanvas label={hero.label} avoid={heroCopy} />
        <div ref={heroCopy} className="sl-hero__copy">
          <h1 id="sl-hero-title" className="sant-display sl-hero__title">
            {hero.title}
          </h1>
          <p className="sl-hero__lede">{hero.lede}</p>
          <div className="sl-hero__actions">
            <Button onClick={record}>{hero.cta}</Button>
            <Button variant="ghost" href="#proof">
              {hero.secondary}
            </Button>
          </div>
          <p className="sl-hero__brand">{hero.brand}</p>
        </div>
      </section>

      <section className="sl-beat" aria-labelledby="sl-problem">
        <SectionHeader id="sl-problem" title={problem.title} note={<Source>{problem.sources}</Source>} />
        <div className="sl-prose">
          {problem.body.map((p) => (
            <p key={p}>{p}</p>
          ))}
          <p className="sl-caveat">{problem.estimates}</p>
        </div>
        <h3 className="sl-subhead">{problem.labs.title}</h3>
        <ul className="sl-labs">
          {problem.labs.rows.map((r) => (
            <li key={r.who}>
              <strong>{r.who}</strong>
              <span>{r.what}</span>
            </li>
          ))}
        </ul>
        <h3 className="sl-subhead">{problem.gap.title}</h3>
        <p className="sl-prose">{problem.gap.body}</p>
      </section>

      <section id="how" ref={howRef} className="sl-beat sl-how" aria-labelledby="sl-how">
        <h2 id="sl-how" className="sant-h2">
          {how.title}
        </h2>
        <div className="sl-how__grid">
          <ol className="sl-steps">
            {how.steps.map((s, i) => (
              <li key={s.name} className="sl-step">
                <span className="sl-step__n">
                  {i + 1} {s.name}
                </span>
                <h3 className="sl-step__title">{s.title}</h3>
                <p>{s.body}</p>
                {"fact" in s && (
                  <p className="sl-step__fact">
                    {s.fact} <Source>{s.source}</Source>
                  </p>
                )}
              </li>
            ))}
          </ol>
          <figure className="sl-how__figure">
            <DotMatrix src={replayFrame} label={how.matrix.label} progressFrom={howRef} />
            <figcaption>{how.matrix.caption}</figcaption>
          </figure>
        </div>
      </section>

      <section id="proof" className="sl-beat sl-proof" aria-labelledby="sl-proof">
        <SectionHeader id="sl-proof" title={proof.title} />
        <div className="sl-proof__body">
          <CountUpTiles from={proof.tiles.from} to={proof.tiles.to} decimals={1} suffix="%" label={proof.tiles.label} />
          <div className="sl-proof__bars">
            <ResultBars arms={proof.arms} p={proof.p} />
            <p>{proof.scenes}</p>
            <p>{proof.plateau}</p>
          </div>
        </div>
        <div className="sl-limits">
          <h3 className="sl-subhead">{proof.limitsTitle}</h3>
          <ul>
            {proof.limits.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <Source>{proof.source}</Source>
          <Button variant="secondary" to={proof.more.to}>
            {proof.more.label}
          </Button>
        </div>
      </section>

      <section className="sl-beat" aria-labelledby="sl-robot">
        <SectionHeader id="sl-robot" title={robot.title} note={<Source>{robot.source}</Source>} />
        <div className="sl-robot">
          <div className="sl-prose">
            <p>{robot.body}</p>
            <p>{robot.example}</p>
            <p>
              <Badge tone="info">{robot.status}</Badge>
            </p>
            <Button variant="secondary" to={robot.more.to}>
              {robot.more.label}
            </Button>
          </div>
          <ul className="sl-shelf" aria-label="Robots tested so far">
            {robot.shelf.map((r) => (
              <li key={r.name} className="sl-cart" data-out={r.sticker === "Design flaw found"}>
                <span className="sl-cart__name">{r.name}</span>
                <span className="sl-cart__note">{r.note}</span>
                <span className="sl-cart__sticker" data-tone={r.sticker === "Design flaw found" ? "issue" : "ok"}>
                  {r.sticker}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="sl-beat" aria-labelledby="sl-nemotron">
        <SectionHeader id="sl-nemotron" title={nemotron.title} />
        <div className="sl-findings">
          {nemotron.cards.map((c) => (
            <article key={c.title} className="sl-finding">
              <h3 className="sl-finding__title">{c.title}</h3>
              <p>{c.body}</p>
              <Source>{c.source}</Source>
            </article>
          ))}
        </div>
        <p className="sl-prose sl-next">{nemotron.next}</p>
        <p className="sl-caveat">
          {nemotron.cost} <Source>{nemotron.costSource}</Source>
        </p>
      </section>

      <section className="sl-closing" aria-labelledby="sl-try">
        <div className="sl-closing__copy">
          <h2 id="sl-try" className="sant-display sl-closing__title">
            {tryIt.title}
          </h2>
          <p>{tryIt.body}</p>
          <Button onClick={record}>{tryIt.cta}</Button>
          <p className="sl-caveat">
            Needs the local SANT backend and an Isaac Lab sim worker; see the{" "}
            <a href={`${REPO}/blob/main/docs/RUNBOOK.md`}>RUNBOOK</a>.
          </p>
        </div>
        <figure className="sl-pinch">
          <PinchSheet reducedMotion={reduced} />
          <figcaption>
            <strong>{tryIt.pinch.title}</strong> {tryIt.pinch.body}
          </figcaption>
        </figure>
      </section>
    </StoryShell>
  );
}

export default LandingPage;
