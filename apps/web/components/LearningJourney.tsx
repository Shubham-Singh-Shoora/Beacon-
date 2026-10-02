"use client";

import { useEffect, useState } from "react";
import { lessons } from "@/lib/learn-content";
import type { Lesson } from "@/lib/learn-content";
import { BeaconMark, Icon } from "./Icons";

const STORAGE_KEY = "beacon-learning-v1";
const demo = "/auction/0x1e40451D6ecabA8640559b7dFbe63B41dA52460d";

export function LearningJourney() {
  const [active, setActive] = useState(0);
  const [completed, setCompleted] = useState<string[]>([]);
  const [persistent, setPersistent] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
      if (Array.isArray(stored))
        setCompleted([
          ...new Set(
            stored.filter(
              (id): id is string =>
                typeof id === "string" && lessons.some((lesson) => lesson.id === id),
            ),
          ),
        ]);
    } catch {
      setPersistent(false);
    }
  }, []);
  function save(next: string[]) {
    setCompleted(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      setPersistent(false);
    }
  }
  function select(index: number) {
    setActive(index);
    document.getElementById("lesson-detail")?.scrollIntoView({ block: "start" });
  }
  return (
    <section className="learning-journey" aria-label="Interactive auction field guide">
      <div className="journey-heading">
        <div>
          <span className="eyebrow">YOUR EXPLORATION MAP</span>
          <h2>Follow your curiosity.</h2>
          <p>Six stops. Small discoveries. A clearer picture of the whole.</p>
        </div>
        <div className="journey-progress">
          <span aria-live="polite">
            <strong>{completed.length}</strong> / 6 checkpoints
          </span>
          <div
            className="journey-progress-track"
            role="progressbar"
            aria-label="Learning progress"
            aria-valuemin={0}
            aria-valuemax={6}
            aria-valuenow={completed.length}
          >
            <i style={{ width: `${(completed.length / 6) * 100}%` }} />
          </div>
          <small>
            {persistent ? "Progress saved on this browser" : "Progress kept for this visit"}
          </small>
        </div>
      </div>
      <div className="learning-map">
        <div className="map-caption">
          <span>
            <Icon name="globe" width="14" height="14" /> THE BEACON FIELD GUIDE
          </span>
          <span>Choose any stop to explore</span>
        </div>
        <svg
          className="map-trail"
          viewBox="0 0 1000 320"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            d="M165 85H820Q945 85 945 160T820 240H165"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray="5 8"
          />
        </svg>
        <ol className="map-stations">
          {lessons.map((lesson, index) => (
            <li key={lesson.id} data-stop={index + 1}>
              <button
                className={`map-station${active === index ? " is-active" : ""}${completed.includes(lesson.id) ? " is-complete" : ""}`}
                onClick={() => select(index)}
                aria-current={active === index ? "step" : undefined}
                aria-label={`Checkpoint ${index + 1}: ${lesson.title}${completed.includes(lesson.id) ? ", completed" : ""}`}
              >
                <span className="station-number">
                  {completed.includes(lesson.id) ? (
                    <Icon name="check" width="15" height="15" />
                  ) : (
                    `0${index + 1}`
                  )}
                </span>
                <span className="station-text">
                  <strong>{lesson.title}</strong>
                  <small>{lesson.subtitle}</small>
                </span>
                <Icon name={lesson.icon} width="18" height="18" />
              </button>
            </li>
          ))}
        </ol>
        <div className="map-legend">
          <span>
            <i /> Your current stop
          </span>
          <span>
            <Icon name="check" width="12" height="12" /> A discovery collected
          </span>
          <span>No wallet needed. No locked paths.</span>
        </div>
      </div>
      <LessonDetail
        key={`${lessons[active]!.id}-${attempt}`}
        lesson={lessons[active]!}
        index={active}
        complete={completed.includes(lessons[active]!.id)}
        onComplete={() => {
          const id = lessons[active]!.id;
          if (!completed.includes(id)) save([...completed, id]);
        }}
        onNext={() => select((active + 1) % lessons.length)}
      />
      {completed.length === lessons.length && (
        <div className="journey-finish" role="status">
          <span className="finish-mark">
            <BeaconMark />
          </span>
          <div>
            <span className="eyebrow">EVERY CHECKPOINT COLLECTED</span>
            <h3>You know how to follow the signal.</h3>
            <p>
              Take your field notes into the directory, or turn what you learned into something of
              your own.
            </p>
          </div>
          <a href="/#auctions" className="button button-primary">
            Go exploring <Icon name="arrow" />
          </a>
        </div>
      )}
      <div className="journey-footnote">
        <span>Your answers stay in this browser. Revisit any checkpoint whenever you like.</span>
        {completed.length > 0 && (
          <button
            type="button"
            onClick={() => {
              save([]);
              setActive(0);
              setAttempt((value) => value + 1);
            }}
          >
            Reset progress
          </button>
        )}
      </div>
    </section>
  );
}

function LessonDetail({
  lesson,
  index,
  complete,
  onComplete,
  onNext,
}: {
  lesson: Lesson;
  index: number;
  complete: boolean;
  onComplete: () => void;
  onNext: () => void;
}) {
  const [answer, setAnswer] = useState<number | null>(null);
  const [result, setResult] = useState<boolean | null>(null);
  return (
    <article id="lesson-detail" className="lesson-detail">
      <div className="lesson-topline">
        <span className="eyebrow">FIELD NOTES / 0{index + 1}</span>
        <span>
          {complete ? (
            <>
              <Icon name="check" width="14" height="14" /> Checkpoint collected
            </>
          ) : (
            "Read · Explore · Put it to the test"
          )}
        </span>
      </div>
      <div className="lesson-layout">
        <div className="lesson-reading">
          <h2>{lesson.heading}</h2>
          <p className="lesson-intro">{lesson.intro}</p>
          <dl className="lesson-concepts">
            {lesson.concepts.map((concept) => (
              <div key={concept.term}>
                <dt>{concept.term}</dt>
                <dd>{concept.text}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="lesson-practice">
          <div className="practice-topline">
            <Icon name="sparkles" width="16" height="16" />
            <span>THE DISCOVERY LAB</span>
          </div>
          <LessonVisual id={lesson.id} />
          <div className="field-mission">
            <span>YOUR MINI MISSION</span>
            <p>{lesson.mission}</p>
          </div>
        </div>
      </div>
      <form
        className="checkpoint-quiz"
        onSubmit={(event) => {
          event.preventDefault();
          const correct = answer === lesson.correct;
          setResult(correct);
          if (correct) onComplete();
        }}
      >
        <fieldset>
          <legend>
            <span className="eyebrow">COLLECT THIS CHECKPOINT</span>
            {lesson.question}
          </legend>
          <div className="quiz-options">
            {lesson.answers.map((option, i) => (
              <label key={option} className={answer === i ? "chosen" : ""}>
                <input
                  type="radio"
                  name={`answer-${lesson.id}`}
                  value={i}
                  checked={answer === i}
                  onChange={() => {
                    setAnswer(i);
                    setResult(null);
                  }}
                />
                <span className="answer-letter">{String.fromCharCode(65 + i)}</span>
                <span>{option}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="quiz-footer">
          <p className={`quiz-feedback${result === true ? " correct" : ""}`} role="status">
            {result === null
              ? "A small question to make the idea stick."
              : `${result ? "That’s it. " : "Not quite. "}${lesson.explanation}`}
          </p>
          <div>
            {result !== true && (
              <button type="submit" className="button button-soft" disabled={answer === null}>
                Check my answer <Icon name="check" width="16" height="16" />
              </button>
            )}
            {(complete || result === true) && (
              <button type="button" className="button button-primary" onClick={onNext}>
                {index === 5 ? "Revisit the map" : "Next discovery"}
                <Icon name="arrow" width="16" height="16" />
              </button>
            )}
          </div>
        </div>
      </form>
    </article>
  );
}

function LessonVisual({ id }: { id: string }) {
  const [released, setReleased] = useState(50);
  const [cap, setCap] = useState(0.0015);
  const [graduated, setGraduated] = useState(true);
  const [checked, setChecked] = useState<string[]>([]);
  if (id === "discover")
    return (
      <div className="lab-visual">
        <div className="lab-caption">ILLUSTRATIVE AUCTION CARD</div>
        <div className="anatomy-card">
          <div className="anatomy-row">
            <span className="anatomy-token">
              <BeaconMark />
            </span>
            <div>
              <strong>DEMO</strong>
              <small>Example token</small>
            </div>
            <span className="status-badge status-live">Live</span>
          </div>
          <div className="anatomy-values">
            <div>
              <small>Network</small>
              <strong>Sepolia</strong>
            </div>
            <div>
              <small>Bid currency</small>
              <strong>ETH</strong>
            </div>
          </div>
          <div className="anatomy-address">
            <span>AUCTION CONTRACT</span>
            <code>0x1234…abcd</code>
          </div>
        </div>
        <div className="anatomy-key">
          <span>
            <b>01</b> Identify the asset
          </span>
          <span>
            <b>02</b> Read its lifecycle
          </span>
          <span>
            <b>03</b> Verify the contract
          </span>
        </div>
        <small className="lab-disclaimer">An example for learning; not a live auction.</small>
      </div>
    );
  if (id === "supply")
    return (
      <div className="lab-visual">
        <div className="lab-caption">ILLUSTRATIVE SUPPLY SCHEDULE</div>
        <div className="supply-blocks" aria-hidden="true">
          {Array.from({ length: 20 }, (_, i) => (
            <span
              key={i}
              className={
                i < Math.min(released / 5, 5) ? "sold" : i < released / 5 ? "released" : ""
              }
            />
          ))}
        </div>
        <div className="supply-key">
          <span>
            <i className="sold" /> Cleared
          </span>
          <span>
            <i className="released" /> Available, not cleared
          </span>
          <span>
            <i /> Not yet released
          </span>
        </div>
        <label className="lab-slider">
          Move through the schedule <output>{released}%</output>
          <input
            type="range"
            aria-label="Supply schedule released"
            min="0"
            max="100"
            step="5"
            value={released}
            onChange={(event) => setReleased(Number(event.target.value))}
          />
        </label>
        <div className="lab-numbers">
          <div>
            <strong>{released}%</strong>
            <span>Schedule released</span>
          </div>
          <div>
            <strong>{Math.min(released, 25)} / 100</strong>
            <span>Example tokens cleared</span>
          </div>
        </div>
        <small className="lab-disclaimer">
          A simplified example with demand for only 25 tokens. It is not a calculation of a real
          auction’s allocation.
        </small>
      </div>
    );
  if (id === "price")
    return (
      <div className="lab-visual">
        <div className="lab-caption">ILLUSTRATIVE PRICE COMPARISON</div>
        <div className="price-comparison">
          <div className="price-reference">
            <span>Reference clearing price</span>
            <strong>0.0020 ETH</strong>
          </div>
          <div className="cap-line" style={{ bottom: `${35 + (cap / 0.004) * 100}px` }}>
            <span>Your cap · {cap.toFixed(4)} ETH</span>
          </div>
          <div className="clearing-reference" />
          <span className="comparison-axis">PRICE PER TOKEN</span>
        </div>
        <div className="lab-toggle" aria-label="Choose an example price cap">
          {[0.0015, 0.0025, 0.0035].map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={cap === value}
              onClick={() => setCap(value)}
            >
              {value.toFixed(4)}
            </button>
          ))}
        </div>
        <p className="lab-observation">
          {cap < 0.002
            ? "Below the clearing price: this cap cannot buy at the reference price."
            : "Above the clearing price: the price limit permits this price, but a fill is not guaranteed."}
        </p>
        <small className="lab-disclaimer">
          Comparison only. Supply, time, tick alignment, and allocation rules are not simulated.
        </small>
      </div>
    );
  if (id === "outcome")
    return (
      <div className="lab-visual">
        <div className="lab-caption">TWO SEPARATE QUESTIONS</div>
        <div className="outcome-flow">
          <div>
            <Icon name="clock" width="20" height="20" />
            <strong>Has the window closed?</strong>
            <span>Yes → Ended</span>
          </div>
          <span className="flow-connector" />
          <div>
            <Icon name="layers" width="20" height="20" />
            <strong>Was the threshold met?</strong>
            <span className={graduated ? "graduation-yes" : ""}>
              {graduated ? "Yes → Graduated" : "No → Not graduated"}
            </span>
          </div>
        </div>
        <div className="lab-toggle">
          <button type="button" aria-pressed={graduated} onClick={() => setGraduated(true)}>
            Threshold met
          </button>
          <button type="button" aria-pressed={!graduated} onClick={() => setGraduated(false)}>
            Not met
          </button>
        </div>
        <small className="lab-disclaimer">
          The ended status stays the same. Only the graduation condition changes.
        </small>
      </div>
    );
  if (id === "verify")
    return (
      <div className="lab-visual">
        <div className="lab-caption">FOLLOW THE DATA</div>
        <ol className="data-trail">
          {[
            { label: "Factory event", value: "An auction is discovered", icon: "globe" as const },
            {
              label: "Indexed catalogue",
              value: "Address, configuration, metadata",
              icon: "layers" as const,
            },
            {
              label: "Contract read",
              value: "Stored values or a fresh lens checkpoint",
              icon: "code" as const,
            },
            {
              label: "Your observation",
              value: "Network + address + read block",
              icon: "check" as const,
            },
          ].map((node, i) => (
            <li key={node.label}>
              <span>
                <Icon name={node.icon} width="18" height="18" />
              </span>
              <div>
                <small>0{i + 1}</small>
                <strong>{node.label}</strong>
                <p>{node.value}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    );
  return (
    <div className="lab-visual">
      <div className="lab-caption">YOUR FIRST FIELD EXPEDITION</div>
      <a href={demo} target="_blank" rel="noreferrer" className="field-auction-link">
        <span className="anatomy-token">
          <BeaconMark />
        </span>
        <div>
          <strong>Explore the BEACON auction</strong>
          <small>Sepolia · opens in a new tab</small>
        </div>
        <Icon name="external" width="17" height="17" />
      </a>
      <div className="field-checklist">
        {[
          "I verified the network and auction address",
          "I compared supply released with tokens cleared",
          "I checked the closing and graduation outcomes",
          "I found the read block and contract explorer",
        ].map((item) => (
          <label key={item}>
            <input
              type="checkbox"
              checked={checked.includes(item)}
              onChange={(event) =>
                setChecked(
                  event.target.checked
                    ? [...checked, item]
                    : checked.filter((value) => value !== item),
                )
              }
            />
            <span>{item}</span>
          </label>
        ))}
      </div>
      <p className="lab-observation">{checked.length} / 4 observations collected</p>
      <small className="lab-disclaimer">
        The checklist is a practice aid for this visit. Complete the question below to save the
        checkpoint.
      </small>
    </div>
  );
}
