import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon, LandingActions, LandingMenu, type IconName } from '@/components/Landing';
import { t } from '@/lib/strings';

export const metadata: Metadata = {
  title: `${t.product.name} — ${t.product.tagline}`,
  description: t.landing.heroBody,
  robots: { index: true, follow: true },
};

const L = t.landing;

/** Public landing page of the SaaS: what the product does, Log in and Register your gym. */
export default function LandingPage() {
  const year = new Date().getFullYear();
  return (
    <div className="lp">
      <header className="lp-header">
        <div className="lp-container lp-header-inner">
          <Link href="/" className="lp-logo" aria-label={t.product.name}>
            <span className="lp-logo-mark">{t.product.mark}</span>
            <span className="lp-logo-name">{t.product.name}</span>
          </Link>
          <nav className="lp-nav" aria-label="Main">
            <a href="#features">{L.navFeatures}</a>
            <a href="#roles">{L.navRoles}</a>
            <a href="#how">{L.navHow}</a>
          </nav>
          <div className="lp-actions">
            <LandingActions />
          </div>
          <LandingMenu />
        </div>
      </header>

      <main>
        <section className="lp-hero">
          <div className="lp-container lp-hero-grid">
            <div className="lp-hero-copy">
              <p className="lp-eyebrow on-dark">{L.eyebrow}</p>
              <h1 className="lp-hero-title">
                {L.heroTitle.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </h1>
              <p className="lp-hero-body">{L.heroBody}</p>
              <div className="lp-hero-ctas">
                <Link className="btn big lp-btn-light" href="/register">
                  {L.heroPrimary}
                  <Icon name="arrow" size={20} />
                </Link>
                <Link className="btn big lp-btn-outline" href="/login">
                  {L.heroSecondary}
                </Link>
              </div>
              <p className="lp-hero-note">{L.heroNote}</p>
            </div>
            <Preview />
          </div>
        </section>

        <section id="features" className="lp-section">
          <div className="lp-container">
            <p className="lp-eyebrow">{L.featuresEyebrow}</p>
            <h2 className="lp-h2">{L.featuresTitle}</h2>
            <div className="lp-features">
              {L.features.map((f) => (
                <article key={f.title} className="lp-feature">
                  <span className="lp-feature-icon">
                    <Icon name={f.icon as IconName} />
                  </span>
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="roles" className="lp-section lp-section-card">
          <div className="lp-container">
            <p className="lp-eyebrow">{L.rolesEyebrow}</p>
            <h2 className="lp-h2">{L.rolesTitle}</h2>
            <div className="lp-roles">
              {L.roles.map((r, i) => (
                <article key={r.name} className="lp-role">
                  <span className="lp-role-num">{String(i + 1).padStart(2, '0')}</span>
                  <h3>{r.name}</h3>
                  <p>{r.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="how" className="lp-section">
          <div className="lp-container">
            <p className="lp-eyebrow">{L.howEyebrow}</p>
            <h2 className="lp-h2">{L.howTitle}</h2>
            <ol className="lp-steps">
              {L.steps.map((s, i) => (
                <li key={s.title} className="lp-step">
                  <span className="lp-step-num">{i + 1}</span>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </li>
              ))}
            </ol>
            <div className="lp-security">
              <span className="lp-feature-icon">
                <Icon name="shield" />
              </span>
              <div>
                <h3>{L.securityTitle}</h3>
                <p>{L.securityBody}</p>
              </div>
            </div>
          </div>
        </section>

        <section className="lp-cta">
          <div className="lp-container lp-cta-inner">
            <div>
              <h2 className="lp-cta-title">{L.ctaTitle}</h2>
              <p>{L.ctaBody}</p>
            </div>
            <div className="lp-hero-ctas">
              <Link className="btn big lp-btn-light" href="/register">
                {L.register}
                <Icon name="arrow" size={20} />
              </Link>
              <Link className="btn big lp-btn-outline" href="/login">
                {L.login}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-container lp-footer-inner">
          <span className="lp-logo">
            <span className="lp-logo-mark">{t.product.mark}</span>
            <span className="muted small">{L.footer(year)}</span>
          </span>
          <Link href="/login" className="muted small">
            {L.footerStaff}
          </Link>
        </div>
      </footer>
    </div>
  );
}

/** A drawn illustration of the admin overview and the door check (sample numbers, labelled as such). */
function Preview() {
  const P = L.preview;
  return (
    <div className="lp-preview" aria-hidden>
      <div className="lp-window">
        <div className="lp-window-bar">
          <span />
          <span />
          <span />
          <em>{P.sample}</em>
        </div>
        <div className="lp-window-body">
          <div className="lp-mini-side">
            <strong>{P.gym}</strong>
            <i className="on" />
            <i />
            <i />
            <i />
            <i />
          </div>
          <div className="lp-mini-main">
            <div className="lp-mini-title">{P.label}</div>
            <div className="lp-mini-stats">
              {P.stats.map((s) => (
                <div key={s.label} className={`lp-mini-stat${'danger' in s && s.danger ? ' danger' : ''}`}>
                  <span>{s.label}</span>
                  <b>{s.value}</b>
                </div>
              ))}
            </div>
            <div className="lp-mini-bars">
              {[38, 52, 44, 70, 61, 83, 66, 90, 74, 58, 79, 95].map((h, i) => (
                <i key={i} style={{ height: `${h}%` }} />
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="lp-float lp-float-ok">
        <Icon name="check" size={18} />
        <span>
          <b>IH-0412</b> {P.allowed}
        </span>
      </div>
      <div className="lp-float lp-float-bad">
        <span className="dot" />
        <span>
          <b>IH-0388</b> {P.blocked}
        </span>
      </div>
    </div>
  );
}
