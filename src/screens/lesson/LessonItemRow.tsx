import { MAX_RECOMMENDED_WORDS } from "../../api/constants";
import type { ItemDetail } from "../../api/types";
import { formatPercent } from "../../format";
import AudioBadge from "./AudioBadge";

interface Props {
  item: ItemDetail;
  /** This item's audio is being regenerated. */
  isBusy: boolean;
  /** The whole lesson's audio is being generated. */
  isLessonGenerating: boolean;
  onRegenerate: () => void;
  onPractice: () => void;
}

export default function LessonItemRow({
  item,
  isBusy,
  isLessonGenerating,
  onRegenerate,
  onPractice,
}: Props) {
  return (
    <li className="card item-row">
      <span className="item-pos">{item.position}</span>
      <div className="item-body">
        <div className="item-text">{item.text}</div>
        <div className="muted small item-meta">
          <span className={item.tooLong ? "warn-text" : undefined}>
            {item.wordCount} words{item.tooLong && ` — over ${MAX_RECOMMENDED_WORDS}`}
          </span>
          <AudioBadge status={item.audioStatus} isBusy={isBusy} />
          {item.attemptCount > 0 && (
            <span>
              {item.attemptCount} attempts · best {formatPercent(item.bestAccuracy)}
            </span>
          )}
        </div>
      </div>
      <div className="actions">
        <button
          onClick={onRegenerate}
          disabled={isLessonGenerating || isBusy}
          title="Call Azure again for this item"
        >
          Regenerate
        </button>
        <button onClick={onPractice} title="Practice from this item">
          ▶
        </button>
      </div>
    </li>
  );
}
