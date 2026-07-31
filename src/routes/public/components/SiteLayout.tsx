/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { getFullThemeCSS, type ThemeName } from '../themes';

interface SiteLayoutProps {
  title: string;
  description?: string;
  theme: ThemeName;
  primaryColor?: string;
  secondaryColor?: string;
  hospitalName: string;
  url?: string;
  logoUrl?: string;
  lang?: string;
  children: any;
}

/**
 * Root HTML layout for all hospital public pages.
 * SSR-only — outputs complete HTML document with inlined CSS.
 */
export const SiteLayout: FC<SiteLayoutProps> = (props) => {
  const css = getFullThemeCSS(props.theme, {
    primary: props.primaryColor,
    secondary: props.secondaryColor,
  });

  return (
    <html lang={props.lang || 'en'}>
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title}</title>
        {props.description && (
          <meta name="description" content={props.description} />
        )}
        <meta property="og:title" content={props.title} />
        {props.description && (
          <meta property="og:description" content={props.description} />
        )}
        <meta property="og:type" content="website" />
        {props.url && <meta property="og:url" content={props.url} />}
        {props.logoUrl && <meta property="og:image" content={props.logoUrl} />}
        <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🏥</text></svg>" />
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body>
        <a href="#main-content" class="skip-link">Skip to content</a>
        {props.children}
        <script dangerouslySetInnerHTML={{ __html: `
          document.addEventListener('DOMContentLoaded',function(){
            var btn=document.querySelector('.nav-mobile-toggle');
            var links=document.querySelector('.nav-links');
            if(btn&&links){btn.addEventListener('click',function(){
              var open=links.classList.toggle('nav-open');
              btn.textContent=open?'\\u2715':'\\u2630';
              btn.setAttribute('aria-expanded',String(open));
            })}
          });
        ` }} />
      </body>
    </html>
  );
};
