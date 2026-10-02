import type { IconName } from "@/components/Icons";

export interface Lesson {
  id: string;
  title: string;
  subtitle: string;
  icon: IconName;
  heading: string;
  intro: string;
  concepts: { term: string; text: string }[];
  mission: string;
  question: string;
  answers: string[];
  correct: number;
  explanation: string;
}

export const lessons: Lesson[] = [
  {
    id: "discover",
    title: "Read the terrain",
    subtitle: "The auction directory",
    icon: "search",
    heading: "Start with the auction, not just the token.",
    intro:
      "A token can appear in more than one auction. Each auction has its own contract, supply, bidding currency, and block window. The directory is your starting point for comparing them.",
    concepts: [
      {
        term: "Upcoming → Live → Ended",
        text: "These are time-based states, derived from the auction’s start and end blocks. Ended is a normal stage, not a failure.",
      },
      {
        term: "Token vs. auction address",
        text: "The token contract identifies the asset. The auction contract identifies this particular sale. Use the auction address when opening a widget or following a launch.",
      },
      {
        term: "Network matters",
        text: "Beacon’s directory covers Ethereum, Base, Unichain, Arbitrum and the Sepolia test network. A matching address on another chain is not the same auction - always check the network an auction page names.",
      },
    ],
    mission:
      "Find the token, status, and auction address on the example card. Then open a real auction from the directory and locate the same three things.",
    question: "Two entries share a token symbol. What identifies the specific auction?",
    answers: [
      "The symbol alone",
      "The auction contract and its network",
      "The color of its token icon",
    ],
    correct: 1,
    explanation:
      "Symbols and artwork are not unique identifiers. The auction contract address, together with its network, identifies the sale you are inspecting.",
  },
  {
    id: "supply",
    title: "Follow the supply",
    subtitle: "Released is not sold",
    icon: "layers",
    heading: "A schedule opens the door. Demand decides what clears.",
    intro:
      "A continuous auction makes supply available over a configured schedule. The schedule can finish even if nobody bids. Keep availability and actual sales separate when reading an auction.",
    concepts: [
      {
        term: "Supply offered",
        text: "The total token amount offered by this auction. It is not necessarily the token’s entire circulating or maximum supply.",
      },
      {
        term: "Schedule released",
        text: "How far the supply-release schedule has progressed. At 100%, the full scheduled supply has been made available, regardless of how much demand arrived.",
      },
      {
        term: "Tokens cleared",
        text: "The amount that actually sold through the auction. Compare this with supply offered to see how much of the available supply found demand.",
      },
    ],
    mission:
      "Drag the schedule to 100%. Notice how the example can finish its schedule while leaving most tokens unsold.",
    question: "The schedule is 100% complete. Does that mean all tokens sold?",
    answers: [
      "Yes, a finished schedule means a sold-out auction",
      "No, check tokens cleared separately",
      "Only if the auction used ETH",
    ],
    correct: 1,
    explanation:
      "Schedule progress describes availability over time. Tokens cleared measures actual sales. The two values answer different questions.",
  },
  {
    id: "price",
    title: "Decode the price",
    subtitle: "Your cap and the clearing price",
    icon: "sparkles",
    heading: "Your price cap is a limit, not a promise.",
    intro:
      "The contract determines a clearing price from the auction’s supply and demand. A bid pairs an amount of currency with a maximum price. Setting a higher cap does not guarantee that a bid will be filled.",
    concepts: [
      {
        term: "Clearing price",
        text: "The auction’s price in bid currency per token. A very small number may use scientific notation; 1e−4 is 0.0001.",
      },
      {
        term: "Maximum bid price",
        text: "The highest price permitted by the bid. A cap below the clearing price cannot buy at that clearing price. Actual fills depend on contract allocation rules.",
      },
      {
        term: "Floor and tick spacing",
        text: "The floor is the auction’s minimum configured price. Bids must align to valid price ticks; the SDK rounds a submitted cap down to a valid boundary.",
      },
    ],
    mission:
      "Switch between the three example caps. Compare each with the reference price. This demonstrates a price comparison, not a fill or return simulation.",
    question: "What does raising your maximum bid price guarantee?",
    answers: [
      "A full allocation",
      "A profit when the auction ends",
      "Neither; it changes the highest price you permit",
    ],
    correct: 2,
    explanation:
      "A cap controls the price limit. It cannot guarantee allocation, a future market price, or profit.",
  },
  {
    id: "outcome",
    title: "Read the outcome",
    subtitle: "Closing and graduation",
    icon: "check",
    heading: "A finish line. Two different outcomes.",
    intro:
      "An auction ends when its block window closes. Graduation is a separate condition: the auction must meet its configured funding threshold. Do not infer one from the other.",
    concepts: [
      {
        term: "Ended",
        text: "The bidding window is closed. Inspect the final clearing price, currency raised, and tokens cleared to understand what happened.",
      },
      {
        term: "Graduated",
        text: "The auction met its configured graduation threshold. This is a contract condition, not a quality rating or a promise about future token value.",
      },
      {
        term: "Not graduated",
        text: "The threshold was not met. It does not tell you, by itself, that no tokens cleared; inspect the amounts as well.",
      },
    ],
    mission:
      "Toggle whether the funding threshold was met. The auction stays ended in both cases, while its graduation outcome changes.",
    question: "An ended auction did not graduate. What can you conclude?",
    answers: [
      "Its funding threshold was not met",
      "The auction is still open",
      "Its token can never have value",
    ],
    correct: 0,
    explanation:
      "Graduation reports the configured threshold. It does not change the fact that the auction has ended and is not a prediction about the asset.",
  },
  {
    id: "verify",
    title: "Trace the signal",
    subtitle: "From a number to its source",
    icon: "globe",
    heading: "Every number has a source. Follow it.",
    intro:
      "Discovery, configuration, and auction state are different layers. Knowing where each comes from helps you spot an old index, an unavailable read, or a stored checkpoint that differs from the latest calculated state.",
    concepts: [
      {
        term: "The indexed record",
        text: "Factory events discover auction addresses. A local catalogue keeps their configuration and token metadata. New launches appear after another index sync.",
      },
      {
        term: "Directory vs. detail",
        text: "The directory uses batch reads of stored contract values. The detail view uses the SDK’s state lens to calculate a fresh checkpoint. Those values can differ until the stored state is updated.",
      },
      {
        term: "Check the evidence",
        text: "Read the network and indexed block, open the auction’s explorer link, and distinguish an unavailable value from zero. A cached-status notice means the latest status could not be verified.",
      },
    ],
    mission:
      "Follow the data path below. In a real detail view, find the explorer link and the network block shown with its state.",
    question: "A value is shown as unavailable. How should you interpret it?",
    answers: [
      "The value is zero",
      "The read could not be verified",
      "The auction did not graduate",
    ],
    correct: 1,
    explanation:
      "Missing data is not a zero or an outcome. Wait for a successful read or inspect the contract through its explorer.",
  },
  {
    id: "fieldwork",
    title: "Make a discovery",
    subtitle: "Put your knowledge to work",
    icon: "external",
    heading: "Your first independent exploration.",
    intro:
      "Now connect the pieces. Open an indexed auction and build a small evidence trail: where it lives, what was offered, how it progressed, and what its outcome actually means.",
    concepts: [
      {
        term: "Identify",
        text: "Record the network, token symbol, auction address, and bid currency. Check that you are reading the intended auction.",
      },
      {
        term: "Compare",
        text: "Read supply offered, schedule released, and tokens cleared as three separate values. Compare the clearing price with the configured floor.",
      },
      {
        term: "Explain",
        text: "Describe whether the window has ended and whether the auction graduated. Include the block of the read and any unavailable data.",
      },
    ],
    mission:
      "Open the example auction, work through the field checklist, and answer the final checkpoint. You do not need a wallet to investigate.",
    question: "Which is the most useful summary of an auction?",
    answers: [
      "Its symbol and how attractive the icon looks",
      "A prediction of tomorrow’s price",
      "Its network, contract, observed metrics, and outcome",
    ],
    correct: 2,
    explanation:
      "A useful summary is grounded in identifiable onchain evidence. You have completed the route from discovery to verification.",
  },
];
