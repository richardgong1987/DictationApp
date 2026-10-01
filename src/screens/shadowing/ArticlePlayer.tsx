import { isRunning, type ShadowingPlayer, type ShadowingState } from "./shadowingPlayer";

interface Props {
  state: ShadowingState;
  player: ShadowingPlayer;
  passageCount: number;
}

/** Plays every passage in order, without pauses, for reading along with the whole article. */
export default function ArticlePlayer({ state, player, passageCount }: Props) {
  return (
    <section className="card article-player" aria-label="Full article">
      <div className="player-bar">
        <div className="transport">
          <button
            type="button"
            className="primary play"
            onClick={() => player.toggleArticle()}
            title="Play every passage in order"
          >
            {articlePlayLabel(state)}
          </button>
          <button
            type="button"
            onClick={() => player.restartArticle()}
            title="Play the article from the beginning"
          >
            ⏮ Restart
          </button>
        </div>

        <span className="article-status muted small" role="status">
          {articleStatus(state, passageCount)}
        </span>

        <button
          type="button"
          className={state.isArticleLooping ? "toggle on" : "toggle"}
          onClick={() => player.setArticleLooping(!state.isArticleLooping)}
          aria-pressed={state.isArticleLooping}
          title="Start the article over after the last passage"
        >
          ⟳ Loop article
        </button>
      </div>

      {state.mode === "article" && state.phase === "failed" && (
        <div className="banner error" role="alert">
          <span>{state.error}</span>
          <button type="button" onClick={() => player.retry()}>
            Retry
          </button>
        </div>
      )}
    </section>
  );
}

function articlePlayLabel(state: ShadowingState): string {
  if (state.mode !== "article" || state.phase === "ended") return "▶ Play article";
  if (isRunning(state)) return "❚❚ Pause";
  return state.phase === "failed" ? "▶ Play article" : "▶ Resume";
}

function articleStatus(state: ShadowingState, passageCount: number): string {
  const passage = `Passage ${state.index + 1} of ${passageCount}`;
  switch (state.mode) {
    case "idle":
      return "Play every passage in order and read along.";
    case "passage":
      return `Practicing passage ${state.index + 1} on its own.`;
    case "article":
      if (state.phase === "ended") return "Finished the article.";
      if (state.phase === "failed") return `Stopped at passage ${state.index + 1}.`;
      if (state.phase === "loading") return `${passage} · loading…`;
      return `${passage}${state.isPaused ? " · paused" : ""}`;
  }
}
