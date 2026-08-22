import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

import { Colors } from '@/lib/theme';

/**
 * The HTML shell for the web build. Web only — this file is never bundled into
 * the native app.
 *
 * It exists for one reason: the React tree paints `Colors.bg`, but it cannot
 * paint anything before it has mounted. Without a background on `html`/`body`
 * the browser shows its own white default during load, and the overscroll
 * gutter stays white forever — a white flash at the top of a dark app.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        {/* `shrink-to-fit=no` keeps iOS Safari from zooming out on focus. */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
        {/* Tells the browser to render form controls and scrollbars dark. */}
        <meta name="color-scheme" content="dark" />
        <meta name="theme-color" content={Colors.bg} />

        {/*
          Disables body scrolling on web so ScrollViews behave like they do on
          native. Remove this if a page ever needs the document itself to scroll.
        */}
        <ScrollViewStyleReset />

        <style dangerouslySetInnerHTML={{ __html: shellStyle }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

const shellStyle = `
html, body, #root {
  background-color: ${Colors.bg};
  color-scheme: dark;
}
body {
  margin: 0;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
`;
