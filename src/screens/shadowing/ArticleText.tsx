import { Fragment, memo, useEffect, useRef, type KeyboardEvent, type RefObject } from "react";
import type { ItemDetail } from "../../api/types";
import type { Segment } from "./passageSegments";
import type { RepeatUnit } from "./shadowingPlayer";

interface Props {
  items: ItemDetail[];
  /** The sentences or phrases of each passage measured so far, by item id; none when played whole. */
  segmentsById: ReadonlyMap<number, Segment[]>;
  unit: RepeatUnit;
  /** The passage in the player; null while nothing is. */
  currentIndex: number | null;
  currentSegment: number;
  playSegment: (index: number, segment: number) => void;
}

/**
 * The whole article as one text, a paragraph per passage. Clicking a passage,
 * sentence or phrase plays from there, and the part being played stays in view.
 * Memoized: the player re-renders the screen on every frame while audio plays.
 */
export default memo(function ArticleText({
  items,
  segmentsById,
  unit,
  currentIndex,
  currentSegment,
  playSegment,
}: Props) {
  const currentRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [currentIndex, currentSegment]);

  return (
    <article className={unit === "passage" ? "article-text whole" : "article-text"}>
      {items.map((item, index) => (
        <PassageText
          key={item.id}
          text={item.text}
          segments={segmentsById.get(item.id)}
          unit={unit}
          current={index === currentIndex ? currentSegment : null}
          currentRef={currentRef}
          playPart={(part) => playSegment(index, part)}
        />
      ))}
    </article>
  );
});

function PassageText({
  text,
  segments,
  unit,
  current,
  currentRef,
  playPart,
}: {
  text: string;
  segments: Segment[] | undefined;
  unit: RepeatUnit;
  /** The part in the player, if this passage is. */
  current: number | null;
  currentRef: RefObject<HTMLSpanElement | null>;
  playPart: (part: number) => void;
}) {
  const parts: Pick<Segment, "from" | "to">[] = segments?.length
    ? segments
    : [{ from: 0, to: text.length }];

  const onClick = (part: number) => {
    // Selecting a word, to look it up, ends in a click that should not move the player.
    if (window.getSelection()?.isCollapsed !== false) playPart(part);
  };
  const onKeyDown = (event: KeyboardEvent, part: number) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    playPart(part);
  };

  return (
    <p>
      {parts.map((part, index) => (
        <Fragment key={part.from}>
          {text.slice(index === 0 ? 0 : parts[index - 1].to, part.from)}
          <span
            ref={index === current ? currentRef : undefined}
            role="button"
            tabIndex={0}
            className={index === current ? "segment current" : "segment"}
            onClick={() => onClick(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
            title={`Play from this ${unit}`}
          >
            {text.slice(part.from, part.to)}
          </span>
        </Fragment>
      ))}
      {text.slice(parts[parts.length - 1].to)}
    </p>
  );
}
