import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import Markdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import {
  Library,
  Plus,
  Search,
  ChevronLeft,
  Minimize2,
  Maximize2,
  Link2,
  BookOpen,
  X,
  Trash2,
} from 'lucide-react';
import { db } from '../db';
import type { Article } from '../db';
import { isContentBlurPersistenceDisabled } from '../config/persistence';
import { extractToc, slugifyHeading } from '../utils/referenceToc';
import { useAppDialog } from './AppDialogProvider';
import { Tooltip } from './ui/Tooltip';

const REFERENCE_MARKDOWN_PLUGINS = [remarkBreaks];

function articleMatchesSearch(a: Article, q: string): boolean {
  if (!q.trim()) return true;
  const low = q.trim().toLowerCase();
  const tags = (a.tags ?? []).join(' ').toLowerCase();
  return (
    a.title.toLowerCase().includes(low) ||
    a.type.toLowerCase().includes(low) ||
    (a.content ?? '').toLowerCase().includes(low) ||
    tags.includes(low)
  );
}

export interface ReferenceProps {
  articles: Article[];
  activeReferenceId: string;
  setActiveReferenceId: (id: string) => void;
  /** 从关联草稿跳转到素材库画布 */
  onOpenCanvas?: (canvasId: string) => void;
}

export function Reference({
  articles,
  activeReferenceId,
  setActiveReferenceId,
  onOpenCanvas,
}: ReferenceProps) {
  const { t } = useTranslation();
  const { confirm, alert: appAlert } = useAppDialog();
  const canvases = useLiveQuery(() => db.canvases.toArray(), []) ?? [];

  const [searchQuery, setSearchQuery] = useState('');
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [noteStatus, setNoteStatus] = useState('');
  const [notesLocal, setNotesLocal] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [contentsOpen, setContentsOpen] = useState(false);
  const [isEditingBody, setIsEditingBody] = useState(false);
  const [citationStatus, setCitationStatus] = useState('');
  /** 正文区作者 / 日期：本地草稿，避免 IndexedDB 回写节流时控件「弹回」或与 flex 挤压导致难以点击 */
  const [draftAuthor, setDraftAuthor] = useState('');
  const [draftDateField, setDraftDateField] = useState('');

  const noteTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const notesDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const authorMetaDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dateMetaDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentsRef = useRef<HTMLDivElement>(null);

  const filteredArticles = useMemo(() => {
    return articles.filter((a) => articleMatchesSearch(a, searchQuery));
  }, [articles, searchQuery]);

  const activeArticle = useMemo(() => {
    return articles.find((a) => a.id === activeReferenceId) ?? articles[0];
  }, [articles, activeReferenceId]);

  useEffect(() => {
    setIsEditingBody(false);
    setNotesLocal(activeArticle?.privateNotes ?? '');
    setDraftAuthor(activeArticle?.author ?? '');
    setDraftDateField(activeArticle?.date ?? '');
    if (authorMetaDebounceRef.current) {
      clearTimeout(authorMetaDebounceRef.current);
      authorMetaDebounceRef.current = null;
    }
    if (dateMetaDebounceRef.current) {
      clearTimeout(dateMetaDebounceRef.current);
      dateMetaDebounceRef.current = null;
    }
  }, [activeArticle?.id]);

  useEffect(() => {
    return () => {
      if (authorMetaDebounceRef.current) clearTimeout(authorMetaDebounceRef.current);
      if (dateMetaDebounceRef.current) clearTimeout(dateMetaDebounceRef.current);
    };
  }, []);

  useEffect(() => {
    if (!contentsOpen) return;
    const onDown = (e: MouseEvent) => {
      if (contentsRef.current && !contentsRef.current.contains(e.target as Node)) {
        setContentsOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [contentsOpen]);

  const handleAddArticle = async () => {
    const id = crypto.randomUUID();
    await db.articles.add({
      id,
      title: t('reference.new_article_title'),
      content: '',
      date: String(new Date().getFullYear()),
      type: 'REF',
      tags: [],
      linkedCanvasIds: [],
      author: '',
      privateNotes: '',
    });
    setActiveReferenceId(id);
  };

  const handleDeleteArticle = async (article: Article, e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await confirm({
      message: t('reference.delete_confirm', { title: article.title }),
      variant: 'danger',
      confirmLabel: t('dialog.confirm'),
      cancelLabel: t('dialog.cancel'),
    });
    if (!ok) return;
    await db.articles.delete(article.id);
    if (activeReferenceId === article.id) {
      const remaining = articles.filter((a) => a.id !== article.id);
      setActiveReferenceId(remaining[0]?.id ?? '');
    }
  };

  const onNotesChange = useCallback(
    (v: string) => {
      setNotesLocal(v);
      const art = activeArticle;
      if (!art) return;
      setNoteStatus(t('reference.note_saving'));
      if (notesDebounceRef.current) clearTimeout(notesDebounceRef.current);
      notesDebounceRef.current = setTimeout(async () => {
        await db.articles.update(art.id, { privateNotes: v });
        setNoteStatus(t('reference.note_saved'));
        if (noteTimeoutRef.current) clearTimeout(noteTimeoutRef.current);
        noteTimeoutRef.current = setTimeout(() => {
          setNoteStatus('');
        }, 2000);
      }, 500);
    },
    [activeArticle],
  );

  const toc = useMemo(() => (activeArticle ? extractToc(activeArticle.content) : []), [activeArticle]);

  const scrollToHeading = (slug: string) => {
    const el = document.getElementById(`ref-heading-${activeArticle?.id}-${slug}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setContentsOpen(false);
  };

  const copyCitation = async () => {
    if (!activeArticle) return;
    const authorForCitation = draftAuthor.trim() || activeArticle.author?.trim();
    const authorPart = authorForCitation ? `${authorForCitation}. ` : '';
    const dateForCitation = draftDateField.trim() || activeArticle.date;
    const line = `${authorPart}${activeArticle.title} (${dateForCitation}). ${activeArticle.type}.`;
    try {
      await navigator.clipboard.writeText(line);
      setCitationStatus('ok');
      setTimeout(() => setCitationStatus(''), 2500);
    } catch {
      void appAlert({ message: t('reference.citation_failed') });
    }
  };

  const addTag = () => {
    const v = tagInput.trim();
    if (!v || !activeArticle) return;
    const tags = [...(activeArticle.tags ?? [])];
    if (tags.includes(v)) return;
    tags.push(v);
    void db.articles.update(activeArticle.id, { tags });
    setTagInput('');
  };

  const removeTag = (tag: string) => {
    if (!activeArticle) return;
    const tags = (activeArticle.tags ?? []).filter((x) => x !== tag);
    void db.articles.update(activeArticle.id, { tags: tags.length ? tags : undefined });
  };

  const linkedIds = activeArticle?.linkedCanvasIds ?? [];

  const markdownHeadingId = (slug: string) =>
    activeArticle ? `ref-heading-${activeArticle.id}-${slug}` : undefined;

  const markdownComponents = useMemo(() => {
    if (!activeArticle) return undefined;
    const mk =
      (Tag: 'h1' | 'h2' | 'h3') =>
      ({ children }: { children?: React.ReactNode }) => {
        const text = String(children ?? '').trim();
        const slug = slugifyHeading(text);
        const levelClass =
          Tag === 'h1'
            ? 'text-2xl font-bold mt-8 mb-4'
            : Tag === 'h2'
              ? 'text-xl font-bold mt-6 mb-3'
              : 'text-lg font-semibold mt-4 mb-2';
        return (
          <Tag id={markdownHeadingId(slug)} className={`scroll-mt-24 ${levelClass}`}>
            {children}
          </Tag>
        );
      };
    return {
      h1: mk('h1'),
      h2: mk('h2'),
      h3: mk('h3'),
      p: ({ children }: { children?: React.ReactNode }) => (
        <p className="mb-4 last:mb-0">{children}</p>
      ),
    };
  }, [activeArticle?.id]);

  return (
    <div className="flex-1 flex min-h-0 bg-app-surface paper-texture overflow-hidden">
      {!isFullScreen && (
        <div className="w-64 border-r border-app-border bg-app-surface-raised flex flex-col z-10 shadow-sm relative shrink-0">
          <div className="p-4 border-b border-app-border bg-app-surface-subtle/50 flex-shrink-0">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-sm font-sans text-app-text flex items-center gap-2">
                <Library className="w-4 h-4" />
                {t('reference.index_title')}
              </h2>
              <button
                type="button"
                onClick={() => void handleAddArticle()}
                className="text-app-text-faint hover:text-app-text transition-colors p-1 rounded hover:bg-app-surface-sunken"
                title={t('reference.add_article')}
                aria-label={t('reference.add_article')}
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <div className="mt-4 relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-app-text-faint" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('reference.search_refs')}
                className="w-full text-xs font-sans bg-app-surface-raised border border-app-border pl-9 pr-3 py-2 rounded-md focus:outline-none focus:border-app-accent focus:ring-1 focus:ring-app-accent transition-all shadow-sm"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {articles.length === 0 ? (
              <p className="text-xs text-app-text-faint px-1">{t('reference.empty_library')}</p>
            ) : filteredArticles.length === 0 ? (
              <p className="text-xs text-app-text-faint px-1">{t('reference.no_matches')}</p>
            ) : (
              filteredArticles.map((article) => (
                <div
                  key={article.id}
                  data-testid={`reference-list-item-${article.id}`}
                  onClick={() => setActiveReferenceId(article.id)}
                  className={`p-3 border rounded-md cursor-pointer transition-all relative overflow-hidden group ${
                    activeReferenceId === article.id
                      ? 'bg-app-surface-subtle border-app-accent/30'
                      : 'bg-app-surface-raised border-transparent hover:border-app-border hover:bg-app-surface hover:shadow-sm'
                  }`}
                >
                  <div className="flex justify-between items-start mb-1.5 gap-1">
                    <span
                      className={`min-w-0 truncate ${
                        activeReferenceId === article.id ? 'text-app-accent' : 'text-app-text-faint'
                      } text-[10px] uppercase tracking-wider font-mono font-bold`}
                    >
                      {article.type}
                    </span>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className="text-app-text-faint text-[10px]">{article.date}</span>
                      <button
                        type="button"
                        data-testid={`reference-delete-${article.id}`}
                        title={t('reference.delete_article')}
                        aria-label={t('reference.delete_article')}
                        onClick={(e) => void handleDeleteArticle(article, e)}
                        className="rounded p-0.5 text-app-text-faint opacity-0 transition-all hover:bg-app-surface-sunken hover:text-app-accent group-hover:opacity-100 focus:opacity-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-app-accent/40"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </div>
                  </div>
                  <h3 className="font-bold text-sm leading-tight mb-1 font-serif pr-6 text-app-text">
                    {article.title}
                  </h3>
                  <p className="text-app-text-muted text-xs font-sans truncate">
                    {(article.content || '').slice(0, 50)}
                    {(article.content || '').length > 0 ? '…' : ''}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto relative bg-app-surface border-r border-app-border">
        <div className="sticky top-0 w-full h-14 bg-app-surface-raised/80 backdrop-blur-md border-b border-app-border flex items-center justify-between px-6 z-10">
          <div className="flex items-center gap-4 text-app-text-muted">
            <button
              type="button"
              onClick={() => isFullScreen && setIsFullScreen(false)}
              disabled={!isFullScreen}
              className={`hover:text-app-text transition-colors ${!isFullScreen ? 'opacity-30 pointer-events-none' : ''}`}
              aria-label={t('reference.immersive_exit')}
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => setIsFullScreen(!isFullScreen)}
              className="hover:text-app-text transition-colors p-1 bg-app-surface-raised hover:bg-app-surface-sunken rounded border border-app-border shadow-sm ml-[-4px]"
              aria-label={isFullScreen ? t('reference.immersive_exit') : t('reference.immersive_enter')}
              title={isFullScreen ? t('reference.immersive_exit') : t('reference.immersive_enter')}
            >
              {isFullScreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <div className="relative" ref={contentsRef}>
              <button
                type="button"
                onClick={() => activeArticle && setContentsOpen(!contentsOpen)}
                disabled={!activeArticle}
                className="text-xs font-sans font-medium hover:text-app-text disabled:opacity-40"
              >
                {t('reference.contents')}
              </button>
              {contentsOpen && activeArticle ? (
                <div className="absolute left-0 top-full mt-1 min-w-[12rem] bg-app-surface-raised border border-app-border rounded-md shadow-lg py-2 z-20 max-h-64 overflow-y-auto">
                  {toc.length === 0 ? (
                    <p className="px-3 py-2 text-[11px] text-app-text-faint">{t('reference.contents_empty')}</p>
                  ) : (
                    toc.map((item, idx) => (
                      <button
                        key={`${item.slug}-${idx}`}
                        type="button"
                        onClick={() => scrollToHeading(item.slug)}
                        className="w-full text-left px-3 py-1.5 text-[11px] text-app-text hover:bg-app-surface-subtle"
                        style={{ paddingLeft: `${8 + (item.level - 1) * 10}px` }}
                      >
                        {item.text}
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {citationStatus === 'ok' && (
              <span className="text-[10px] text-green-600 font-sans">{t('reference.citation_copied')}</span>
            )}
            <button
              type="button"
              onClick={() => void copyCitation()}
              disabled={!activeArticle}
              className="text-xs font-sans font-medium text-app-text-muted hover:text-app-text bg-app-surface-raised border border-app-border px-3 py-1.5 rounded shadow-sm flex items-center gap-2 disabled:opacity-40"
            >
              <Link2 className="w-3.5 h-3.5" />
              {t('reference.citation')}
            </button>
          </div>
        </div>

        {!activeArticle ? (
          <div className="max-w-2xl mx-auto my-24 px-6 text-center text-app-text-faint text-sm font-sans">
            {t('reference.empty_library')}
          </div>
        ) : (
          <div className="max-w-2xl mx-auto my-12 bg-app-surface-raised border border-app-border shadow-md relative" key={activeArticle.id}>
            <div className="absolute -top-px -left-px -right-px h-1 bg-app-accent" />

            <div className="p-16">
              <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-10 border-b-2 border-app-text pb-6 mb-10">
                <div className="min-w-0 flex-1 pr-2">
                  <div className="text-app-text-faint font-mono text-xs uppercase tracking-widest mb-3 flex flex-wrap items-center gap-x-1">
                    <span>{t('reference.document_prefix')}</span>
                    <input
                      className="bg-transparent border-0 border-b border-transparent focus:border-app-accent outline-none min-w-[5rem] max-w-[12rem] font-mono text-app-text-faint"
                      value={activeArticle.type}
                      onChange={(e) => void db.articles.update(activeArticle.id, { type: e.target.value })}
                      aria-label={t('reference.document_prefix')}
                    />
                  </div>
                  <h1
                    className="font-serif text-4xl font-bold text-app-text leading-tight max-w-full focus:outline-none hover:bg-app-surface-sunken/50 focus:bg-app-surface-sunken/50 rounded px-2 -mx-2 transition-colors cursor-text"
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={(e) => {
                      if (isContentBlurPersistenceDisabled()) return;
                      void db.articles.update(activeArticle.id, { title: e.currentTarget.innerText });
                    }}
                  >
                    {activeArticle.title}
                  </h1>
                </div>
                <div className="flex shrink-0 w-full flex-col gap-3 text-xs font-sans text-app-text-muted sm:w-auto sm:max-w-[11rem] md:items-end md:text-right">
                  <label className="flex flex-col gap-0.5 sm:items-stretch md:items-end">
                    <span className="shrink-0 font-bold">{t('reference.author_label')}:</span>
                    <input
                      type="text"
                      data-testid="reference-meta-author"
                      className="w-full shrink-0 min-w-0 border-0 bg-transparent px-0.5 py-1 text-app-text-muted outline-none rounded-sm hover:bg-app-surface-subtle/80 focus-visible:bg-app-surface-subtle/80 focus-visible:ring-1 focus-visible:ring-app-accent/35 md:text-right"
                      value={draftAuthor}
                      aria-label={t('reference.author_label')}
                      onChange={(e) => {
                        const v = e.target.value;
                        setDraftAuthor(v);
                        const id = activeArticle.id;
                        if (authorMetaDebounceRef.current) clearTimeout(authorMetaDebounceRef.current);
                        authorMetaDebounceRef.current = setTimeout(() => {
                          authorMetaDebounceRef.current = null;
                          void db.articles.update(id, { author: v });
                        }, 450);
                      }}
                      onBlur={(e) => {
                        if (authorMetaDebounceRef.current) {
                          clearTimeout(authorMetaDebounceRef.current);
                          authorMetaDebounceRef.current = null;
                        }
                        void db.articles.update(activeArticle.id, { author: e.currentTarget.value });
                      }}
                    />
                  </label>
                  <label className="flex flex-col gap-0.5 sm:items-stretch md:items-end">
                    <span className="shrink-0 font-bold">{t('reference.published_label')}:</span>
                    <input
                      type="text"
                      data-testid="reference-meta-date"
                      className="w-full shrink-0 min-w-0 border-0 bg-transparent px-0.5 py-1 text-app-text-muted outline-none rounded-sm hover:bg-app-surface-subtle/80 focus-visible:bg-app-surface-subtle/80 focus-visible:ring-1 focus-visible:ring-app-accent/35 md:text-right"
                      value={draftDateField}
                      aria-label={t('reference.published_label')}
                      onChange={(e) => {
                        const v = e.target.value;
                        setDraftDateField(v);
                        const id = activeArticle.id;
                        if (dateMetaDebounceRef.current) clearTimeout(dateMetaDebounceRef.current);
                        dateMetaDebounceRef.current = setTimeout(() => {
                          dateMetaDebounceRef.current = null;
                          void db.articles.update(id, { date: v });
                        }, 450);
                      }}
                      onBlur={(e) => {
                        if (dateMetaDebounceRef.current) {
                          clearTimeout(dateMetaDebounceRef.current);
                          dateMetaDebounceRef.current = null;
                        }
                        void db.articles.update(activeArticle.id, { date: e.currentTarget.value });
                      }}
                    />
                  </label>
                </div>
              </div>

              <div className="font-serif text-lg leading-relaxed text-app-text">
                {isEditingBody ? (
                  <div
                    className="min-h-[12rem] whitespace-pre-wrap focus:outline-none hover:bg-app-surface-sunken/50 focus:bg-app-surface-sunken/50 rounded px-2 -mx-2 transition-colors cursor-text"
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={(e) => {
                      if (!isContentBlurPersistenceDisabled()) {
                        void db.articles.update(activeArticle.id, {
                          content: e.currentTarget.innerText,
                        });
                      }
                      setIsEditingBody(false);
                    }}
                  >
                    {activeArticle.content}
                  </div>
                ) : (
                  <div
                    className="markdown-body min-h-[12rem] cursor-text rounded px-2 -mx-2 transition-colors hover:bg-app-surface-sunken/30"
                    onClick={() => setIsEditingBody(true)}
                  >
                    <Markdown remarkPlugins={REFERENCE_MARKDOWN_PLUGINS} components={markdownComponents}>
                      {activeArticle.content || `_${t('reference.empty_body')}_`}
                    </Markdown>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {!isFullScreen && (
        <div className="w-72 bg-app-surface-raised flex-shrink-0 flex flex-col font-sans text-xs">
          <div className="p-4 border-b border-app-border font-bold text-app-text h-14 flex items-center bg-app-surface-subtle/50">
            {t('reference.metadata_notes')}
          </div>
          <div className="p-6 space-y-8 overflow-y-auto">
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-app-text-faint font-semibold uppercase tracking-wider text-[10px] flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-app-accent" />
                  {t('reference.tags')}
                </h4>
              </div>
              <div className="flex flex-wrap gap-2 mb-2">
                {(activeArticle?.tags ?? []).map((tag) => (
                  <span
                    key={tag}
                    className="group bg-app-surface-sunken text-app-text-muted px-2 py-1 rounded flex items-center gap-1 text-[11px]"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => removeTag(tag)}
                      className="opacity-60 hover:opacity-100 p-0.5 rounded hover:bg-app-edge"
                      aria-label={t('reference.remove_tag')}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
                  placeholder={t('reference.tag_add_placeholder')}
                  disabled={!activeArticle}
                  className="flex-1 text-[11px] bg-app-surface border border-app-border rounded px-2 py-1.5 focus:outline-none focus:border-app-accent"
                />
                <Tooltip label={t('reference.tag_add')}>
                  <button
                    type="button"
                    onClick={addTag}
                    disabled={!activeArticle}
                    className="p-1.5 rounded border border-app-border hover:bg-app-surface-subtle disabled:opacity-40"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </Tooltip>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-app-text-faint font-semibold uppercase tracking-wider text-[10px] flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-app-text" />
                  {t('reference.linked_drafts')}
                </h4>
              </div>
              <div className="space-y-2">
                {linkedIds.length === 0 ? (
                  <p className="text-[11px] text-app-text-faint">{t('reference.linked_empty')}</p>
                ) : (
                  linkedIds.map((cid) => {
                    const c = canvases.find((x) => x.id === cid);
                    return (
                      <div key={cid} className="flex items-start gap-2 p-3 bg-app-surface border border-app-border rounded">
                        <BookOpen className="w-4 h-4 text-app-accent mt-0.5 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => onOpenCanvas?.(cid)}
                            className="font-semibold text-app-text text-[11px] text-left hover:text-app-accent hover:underline"
                            disabled={!onOpenCanvas}
                          >
                            {c?.name ?? cid}
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-app-text-faint font-semibold uppercase tracking-wider text-[10px] flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-app-text-muted" />
                  {t('reference.private_notes')}
                </h4>
                {noteStatus && (
                  <span
                    className={`text-[10px] ${noteStatus === 'Saved' ? 'text-green-600' : 'text-app-text-faint'}`}
                  >
                    {noteStatus}
                  </span>
                )}
              </div>
              <textarea
                value={notesLocal}
                onChange={(e) => onNotesChange(e.target.value)}
                disabled={!activeArticle}
                className="w-full h-40 bg-app-surface border border-app-border rounded-md p-3 text-app-text-muted resize-none focus:outline-none focus:border-app-accent focus:ring-1 focus:ring-app-accent shadow-sm disabled:opacity-40"
                placeholder={t('reference.notes_placeholder')}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
