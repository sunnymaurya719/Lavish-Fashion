import React from 'react';

/**
 * Shared page header used at the top of every admin page.
 *
 * Layout:
 *   [eyebrow]
 *   [title] ............................. [actions slot]
 *   [description]
 *   [meta slot — sync badge, counts, etc.]
 *
 * Replaces the bespoke `<section className='rounded-[32px] border ...'>` blocks
 * that lived at the top of every page. Shape and visual weight stay close to
 * the previous bespoke headers so existing pages can adopt incrementally.
 */
const PageHeader = ({
  eyebrow,
  title,
  description,
  actions,
  meta,
  className = '',
}) => {
  return (
    <section
      className={`rounded-[28px] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-card)] sm:p-7 ${className}`}
    >
      <div className='flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between'>
        <div className='min-w-0'>
          {eyebrow ? (
            <p className='text-[11px] font-medium uppercase tracking-[0.32em] text-[var(--color-text-subtle)]'>
              {eyebrow}
            </p>
          ) : null}
          <h1 className='mt-1 text-2xl font-semibold text-[var(--color-text-primary)] sm:text-[26px]'>
            {title}
          </h1>
          {description ? (
            <p className='mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-text-secondary)]'>
              {description}
            </p>
          ) : null}
        </div>

        {actions ? (
          <div className='flex flex-wrap items-center gap-2 lg:flex-nowrap lg:justify-end'>
            {actions}
          </div>
        ) : null}
      </div>

      {meta ? <div className='mt-5 flex flex-wrap items-center gap-2'>{meta}</div> : null}
    </section>
  );
};

export default PageHeader;
