# Search discovery and project promotion

The repository is public. The static project page in `docs/index.html` provides readable English content, a page title and description, a canonical URL, social sharing metadata, and SoftwareApplication structured data. It does not require JavaScript to read. `docs/sitemap.xml` lists the project page.

## Enable GitHub Pages

An administrator must enable publishing once:

1. Open [repository Pages settings](https://github.com/richardgong1987/DictationApp/settings/pages).
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Choose **main** and **/docs**, then **Save**.
4. Wait for the Pages deployment to finish and open <https://richardgong1987.github.io/DictationApp/>.
5. Check that <https://richardgong1987.github.io/DictationApp/sitemap.xml> is accessible too.

The desktop app is still downloaded from Releases. The Pages site is its public introduction, not a browser version of the app.

## Tell Google about the site

1. Open [Google Search Console](https://search.google.com/search-console/).
2. Add a **URL-prefix** property for `https://richardgong1987.github.io/DictationApp/`.
3. Choose **HTML tag** verification. Add Google's exact verification meta tag to the `<head>` of `docs/index.html`, publish the change, then select **Verify**. The token is account-specific; this repository does not invent one.
4. Submit `sitemap.xml` in **Sitemaps** for that property.
5. Inspect the project page URL with **URL Inspection**. Test the live URL, then request indexing if it is eligible.
6. Review the indexing report after Google processes the page.

A public page can be discovered without Search Console. Verification gives you visibility into indexing and a way to submit the page; it does not guarantee inclusion, a ranking, or an immediate crawl. The GitHub repository and the Pages site have separate URLs. Verifying this Pages prefix does not verify ownership of `github.com`.

Do not put a `robots.txt` in `/DictationApp/` expecting it to control crawling: robots rules belong at the origin root. This site contains no `noindex` directive. Keep its content accessible without login.

## Repository presentation

Suggested **About** description:

> Free dictation and shadowing app for language learning. Practice with your own text, Azure or ElevenLabs speech, reusable audio, and multilingual voices.

After deployment succeeds, set the repository website to `https://richardgong1987.github.io/DictationApp/` and add relevant topics such as `language-learning`, `dictation`, `shadowing`, `text-to-speech`, `azure-speech`, `elevenlabs`, `tauri`, and `react`.

Link to the live page from the README once it is available. Share it in communities where people want dictation or shadowing practice, with a concrete example and an honest explanation of the free-plan limits. Clear documentation and relevant links help people discover the project; metadata alone does not create an audience.

## Sources

- [GitHub: Configure a Pages publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [Google: Get started with Search Console](https://developers.google.com/search/docs/monitor-debug/search-console-start)
- [Google: Ask Google to recrawl your URLs](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl)
- [Google: Crawling and indexing FAQ](https://developers.google.com/search/help/crawling-index-faq)
