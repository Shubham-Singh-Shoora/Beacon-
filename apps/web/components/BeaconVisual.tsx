/** Decorative glass architecture: a signal emerging from open layers. */
export function BeaconVisual() {
  return (
    <div className="signal-visual" aria-hidden="true">
      <div className="signal-glow" />
      <svg viewBox="0 0 600 500" fill="none" className="signal-art">
        <defs>
          <linearGradient
            id="glass-sheet"
            x1="100"
            y1="210"
            x2="475"
            y2="400"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#fff9ff" stopOpacity=".94" />
            <stop offset=".45" stopColor="#f8d9ee" stopOpacity=".5" />
            <stop offset="1" stopColor="#e5afd9" stopOpacity=".8" />
          </linearGradient>
          <linearGradient
            id="sheet-edge"
            x1="85"
            y1="250"
            x2="450"
            y2="420"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#fff" />
            <stop offset=".6" stopColor="#d6a0c5" />
            <stop offset="1" stopColor="#fcf4fc" />
          </linearGradient>
          <linearGradient
            id="prism-front"
            x1="234"
            y1="108"
            x2="358"
            y2="290"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#ffedf8" />
            <stop offset=".35" stopColor="#ffa4d5" />
            <stop offset=".7" stopColor="#ff51a9" />
            <stop offset="1" stopColor="#d90e80" />
          </linearGradient>
          <linearGradient
            id="prism-side"
            x1="237"
            y1="152"
            x2="383"
            y2="303"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#f86cba" />
            <stop offset="1" stopColor="#99116c" />
          </linearGradient>
          <linearGradient
            id="signal-ray"
            x1="300"
            y1="138"
            x2="300"
            y2="370"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#ef62b0" stopOpacity="0" />
            <stop offset="1" stopColor="#ed70ba" stopOpacity=".24" />
          </linearGradient>
          <linearGradient
            id="signal-line"
            x1="110"
            y1="354"
            x2="490"
            y2="263"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#ceafd0" stopOpacity=".3" />
            <stop offset=".5" stopColor="#f52c95" />
            <stop offset="1" stopColor="#c7a8cb" stopOpacity=".3" />
          </linearGradient>
          <filter id="signal-shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="17" />
          </filter>
        </defs>
        <path
          d="m103 391 194-105 202 113-194 74Z"
          fill="#ac699f"
          opacity=".12"
          filter="url(#signal-shadow)"
        />
        <g className="signal-base">
          <path
            d="m73 333 222-128 229 132v13L303 478 73 346Z"
            fill="url(#sheet-edge)"
            opacity=".62"
          />
          <path
            d="m73 333 222-128 229 132-221 128Z"
            fill="url(#glass-sheet)"
            stroke="#fff"
            strokeWidth="1.5"
          />
          <path d="m106 333 189-109 196 113-188 109Z" stroke="#d9b4d1" strokeDasharray="3 7" />
        </g>
        <g className="signal-middle">
          <path
            d="m99 281 196-113 203 117v10L303 408 99 290Z"
            fill="url(#sheet-edge)"
            opacity=".75"
          />
          <path
            d="m99 281 196-113 203 117-195 113Z"
            fill="url(#glass-sheet)"
            stroke="#fff"
            strokeWidth="1.5"
          />
          <path
            d="m149 306 52-30 46 26 96-55 49 28 53-31"
            stroke="url(#signal-line)"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path d="m194 276 7-4 7 4-7 4Zm143-29 7-4 7 4-7 4Zm101-4 7-4 7 4-7 4Z" fill="#f2459e" />
        </g>
        <path d="m239 149-83 183 149 87 145-84-84-184Z" fill="url(#signal-ray)" />
        <g className="signal-top">
          <path d="m129 227 166-96 173 100v9l-165 96-174-101Z" fill="url(#sheet-edge)" />
          <path
            d="m129 227 166-96 173 100-165 96Z"
            fill="url(#glass-sheet)"
            stroke="#fff"
            strokeWidth="1.8"
          />
          <path d="m149 227 146-84 153 88-145 84Z" stroke="#fff" strokeOpacity=".64" />
          <path
            d="m158 247 35 20m-25-27 35 20m-26-28 35 20"
            stroke="#d6a4c8"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </g>
        <g className="signal-prism">
          <path
            d="m299 53 26 78 74 41-74 35-26 79-26-79-74-41 74-35Z"
            transform="translate(13 14)"
            fill="url(#prism-side)"
          />
          <path
            d="m299 53 26 78 74 41-74 35-26 79-26-79-74-41 74-35Z"
            fill="url(#prism-front)"
            stroke="#ffe3f4"
            strokeWidth="1.2"
          />
          <path d="m299 53 0 118-26-40Z" fill="#fff" opacity=".36" />
          <path d="m199 166 100 5-26 36Z" fill="#fff" opacity=".3" />
          <path d="m299 171 100 1-74 35-26 79Z" fill="#c72288" opacity=".15" />
          <path d="m299 53 0 118 100 1M299 171l-26 36" stroke="#fff" strokeOpacity=".48" />
        </g>
        <path
          d="M85 176v12m-6-6h12M488 130v10m-5-5h10M513 392v10m-5-5h10"
          stroke="#c5a9bf"
          strokeWidth="1.3"
        />
        <path d="m126 125 10-6 10 6-10 6Zm360 209 8-5 8 5-8 5Z" fill="#e3bfd9" />
        <path d="m93 218 39-22M461 366l39-23" stroke="#ceacc6" strokeDasharray="2 5" />
      </svg>
      <div className="signal-tag">
        <span className="signal-tag-icon">↗</span>
        <div>
          <small>THE NEXT LAYER OF POSSIBILITY</small>
          <strong>Every beginning has a signal.</strong>
        </div>
      </div>
      <div className="signal-caption">
        <span>01 / DISCOVER</span>
        <span>02 / UNDERSTAND</span>
        <span>03 / BUILD</span>
      </div>
    </div>
  );
}
