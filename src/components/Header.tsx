import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  LogOut,
  Upload,
  User as UserIcon,
  ChevronDown,
  Search,
  X,
  FileText,
  Globe,
  Check,
  BarChart3,
  Archive,
  Tv,
  MessageCircle,
  ExternalLink,
  Settings,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { LANGUAGES, useLanguage } from '../contexts/LanguageContext';
import { WHATSAPP_CHANNEL_URL } from '../types/cinema';
import { PWAInstallButton } from './PWAInstallButton';
import { TempleLogoIcon } from './TempleLogo';
import type { UserWatchStats } from './MyStatsModal';

export type AppMainView = 'home' | 'search' | 'downloads' | 'lounge';

interface HeaderProps {
  activeView: AppMainView;
  searchQuery: string;
  searchInputRef?: RefObject<HTMLInputElement | null>;
  userStats: UserWatchStats;
  onSelectView: (view: AppMainView, anchorId?: string) => void;
  onSearchChange: (query: string) => void;
  onOpenUpload: () => void;
  onOpenAdminPanel?: () => void;
  onOpenAuth: (mode: 'login' | 'signup') => void;
  onOpenStats: () => void;
  onOpenSettings: () => void;
  onOpenWatchParty: () => void;
  onScrollToChat: () => void;
  onSelectCollection: (view: 'all' | 'saved' | 'uploads') => void;
  onLoggedOut: () => void;
}

export function Header({
  activeView,
  searchQuery,
  searchInputRef,
  userStats,
  onSelectView,
  onSearchChange,
  onOpenUpload,
  onOpenAdminPanel,
  onOpenAuth,
  onOpenStats,
  onOpenSettings,
  onOpenWatchParty,
  onScrollToChat,
  onSelectCollection,
  onLoggedOut,
}: HeaderProps) {
  const { user, profile, isAdmin, logOut, getIdToken } = useAuth();
  const { language, setLanguage, t } = useLanguage();
  const [menuOpen, setMenuOpen] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const langMenuRef = useRef<HTMLDivElement | null>(null);

  const currentLang = LANGUAGES.find((l) => l.code === language) || LANGUAGES[0];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
      if (langMenuRef.current && !langMenuRef.current.contains(e.target as Node)) {
        setLangMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogOut = async () => {
    setMenuOpen(false);
    await logOut();
    onLoggedOut();
  };

  const handleDownloadHostingPdf = async () => {
    if (!isAdmin || downloadingPdf) return;
    setDownloadingPdf(true);
    try {
      const token = await getIdToken();
      if (!token) return;
      const resp = await fetch('/api/admin/hosting-guide.pdf', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) return;
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'templesolosmovies-hosting-and-data.pdf';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMenuOpen(false);
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const catalog = document.getElementById('catalog');
    catalog?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <header className="sticky top-0 z-40 border-b border-[#27272A] bg-[#09090B]/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-3 sm:gap-5 px-4 py-3 sm:px-6 lg:px-8">
        {/* Zone 1: Scalable Temple Cinema SVG Icon (28px) & Gold Wordmark */}
        <button
          type="button"
          onClick={() => onSelectView('home', 'spotlight')}
          className="flex items-center gap-2.5 text-sm sm:text-base font-bold tracking-[0.14em] uppercase text-[#E6A93C] whitespace-nowrap shrink-0 font-display cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#E6A93C]"
        >
          <TempleLogoIcon className="h-7 w-7 shrink-0" />
          <span>{t('templeBrand')}</span>
        </button>

        {/* Zone 2: Single-line Nav Links */}
        <nav
          aria-label="Primary navigation"
          className="hidden xl:flex items-center gap-4 text-xs font-medium text-[#A1A1AA]"
        >
          <button
            type="button"
            onClick={() => onSelectView('home', 'spotlight')}
            className={`transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeView === 'home' ? 'text-[#E6A93C] font-semibold' : 'hover:text-[#FAFAFA]'
            }`}
          >
            {t('navHome')}
          </button>
          <button
            type="button"
            onClick={() => onSelectView('home', 'trending-now')}
            className="hover:text-[#FAFAFA] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {t('navTrending')}
          </button>
          <button
            type="button"
            onClick={() => onSelectView('home', 'coming-soon')}
            className="hover:text-[#FAFAFA] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {t('navComingSoon')}
          </button>
          <button
            type="button"
            onClick={() => {
              onSelectCollection('all');
              onSelectView('search', 'catalog');
            }}
            className={`transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeView === 'search' ? 'text-[#E6A93C] font-semibold' : 'hover:text-[#FAFAFA]'
            }`}
          >
            {t('navCatalog')}
          </button>
          <button
            type="button"
            onClick={() => {
              onSelectCollection('saved');
              onSelectView('search', 'catalog');
            }}
            className="hover:text-[#FAFAFA] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {t('navSaved')}
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => {
                onSelectCollection('uploads');
                onSelectView('search', 'catalog');
              }}
              className="hover:text-[#FAFAFA] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {t('navUploads')}
            </button>
          )}
          <button
            type="button"
            onClick={() => onSelectView('lounge')}
            className={`transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeView === 'lounge' ? 'text-[#E6A93C] font-semibold' : 'hover:text-[#FAFAFA]'
            }`}
          >
            {t('navLounge')}
          </button>
          <button
            type="button"
            onClick={onScrollToChat}
            className="hover:text-[#FAFAFA] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {t('navChat')}
          </button>
          <button
            type="button"
            onClick={onOpenWatchParty}
            className="inline-flex items-center gap-1.5 text-[#E5A93B] hover:text-[#F0B84F] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Tv className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{t('navWatchParty')}</span>
          </button>
          <a
            href={WHATSAPP_CHANNEL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-emerald-400 hover:text-emerald-300 transition-colors whitespace-nowrap shrink-0"
          >
            <MessageCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{t('whatsappChannel')}</span>
          </a>
        </nav>

        {/* Global Pill Search Bar */}
        <form
          onSubmit={handleSearchSubmit}
          role="search"
          aria-label="Global movie search"
          className="relative flex-1 max-w-[200px] sm:max-w-xs lg:max-w-sm"
        >
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#A1A1AA]"
            aria-hidden="true"
          />
          <input
            ref={searchInputRef}
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t('searchMoviesPlaceholder')}
            aria-label={t('searchMoviesPlaceholder')}
            className="w-full rounded-full border border-[#3F3F46] bg-[#141418] py-2 pl-10 pr-8 text-xs sm:text-sm text-[#FAFAFA] placeholder:text-[#71717A] focus:border-[#E5A93B] focus:outline-none transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              aria-label={t('clearSearch')}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-[#71717A] hover:text-[#FAFAFA] cursor-pointer"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </form>

        {/* Zone 3: Language Switcher + Install Prompt + Account Menu */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Language Switcher */}
          <div className="relative" ref={langMenuRef}>
            <button
              type="button"
              onClick={() => {
                setLangMenuOpen((prev) => !prev);
                setMenuOpen(false);
              }}
              aria-expanded={langMenuOpen}
              aria-haspopup="listbox"
              aria-label={`${t('languageLabel')}: ${currentLang.nativeName}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#27272A] bg-[#111114] px-2.5 py-2 text-xs font-medium text-[#D4D4D8] hover:border-[#3F3F46] hover:text-[#FAFAFA] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Globe className="h-3.5 w-3.5 text-[#E5A93B] shrink-0" aria-hidden="true" />
              <span className="font-mono">{currentLang.shortLabel}</span>
              <ChevronDown className="h-3 w-3 text-[#71717A] shrink-0" aria-hidden="true" />
            </button>

            {langMenuOpen && (
              <div
                role="listbox"
                aria-label={t('languageLabel')}
                className="absolute right-0 top-full mt-2 w-44 rounded-xl border border-[#27272A] bg-[#111114] p-1.5 shadow-2xl z-50"
              >
                {LANGUAGES.map((lang) => {
                  const selected = lang.code === language;
                  return (
                    <button
                      key={lang.code}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => {
                        setLanguage(lang.code);
                        setLangMenuOpen(false);
                      }}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs transition-colors cursor-pointer ${
                        selected
                          ? 'bg-[#18181B] text-[#E5A93B] font-semibold'
                          : 'text-[#D4D4D8] hover:bg-[#18181B] hover:text-[#FAFAFA]'
                      }`}
                    >
                      <span>{lang.nativeName}</span>
                      <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-[#71717A]">
                        {lang.shortLabel}
                        {selected && <Check className="h-3 w-3 text-[#E5A93B]" aria-hidden="true" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              setLangMenuOpen(false);
              setMenuOpen(false);
              onOpenSettings();
            }}
            aria-label={t('settingsTitle')}
            title={t('settingsTitle')}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-[#27272A] bg-[#111114] px-2.5 py-2 text-xs font-medium text-[#D4D4D8] hover:border-[#3F3F46] hover:text-[#FAFAFA] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Settings className="h-3.5 w-3.5 text-[#E5A93B] shrink-0" aria-hidden="true" />
            <span className="hidden md:inline">{t('settingsTitle')}</span>
          </button>

          <PWAInstallButton />

          <div className="relative" ref={menuRef}>
            {user ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen((prev) => !prev);
                    setLangMenuOpen(false);
                  }}
                  aria-expanded={menuOpen}
                  className="inline-flex items-center gap-2 rounded-lg border border-[#27272A] bg-[#18181B] px-3.5 py-2 text-xs sm:text-sm font-medium text-[#FAFAFA] hover:border-[#3F3F46] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <UserIcon className="h-4 w-4 text-[#E5A93B] shrink-0" aria-hidden="true" />
                  <span className="max-w-[130px] truncate">
                    {profile?.displayName || user.displayName || 'Account'}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 text-[#A1A1AA] shrink-0" aria-hidden="true" />
                </button>

              {menuOpen && (
                <div className="absolute right-0 top-full mt-2 w-64 rounded-xl border border-[#27272A] bg-[#111114] p-1.5 shadow-2xl">
                  <div className="border-b border-[#27272A] px-3 py-2 mb-1">
                    <p className="text-xs font-semibold text-[#FAFAFA] truncate">
                      {profile?.displayName || user.displayName || 'Member'}
                    </p>
                    <p className="text-[11px] text-[#71717A] truncate">{user.email}</p>
                    <p className="text-[11px] font-mono text-[#E5A93B] mt-0.5">
                      {isAdmin ? t('roleAdmin') : t('roleViewer')}
                    </p>
                  </div>

                  {/* My Stats Quick Summary + Open Panel */}
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onOpenStats();
                    }}
                    className="w-full rounded-lg border border-[#27272A]/80 bg-[#09090B] px-3 py-2 mb-1 text-left hover:border-[#E5A93B]/60 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs font-medium text-[#FAFAFA] mb-1">
                      <span className="inline-flex items-center gap-1.5">
                        <BarChart3 className="h-3.5 w-3.5 text-[#E5A93B]" aria-hidden="true" />
                        <span>{t('myStatsTitle')}</span>
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-[#E5A93B]">
                        {userStats.moviesWatched} · {userStats.totalHours.toFixed(1)}h
                      </span>
                    </div>
                    <p className="text-[11px] text-[#71717A] truncate">
                      {userStats.preferredGenres[0]
                        ? `${t('preferredGenresLabel')}: ${userStats.preferredGenres[0].genre}`
                        : t('myStatsSubtitle')}
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onOpenSettings();
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-[#FAFAFA] hover:bg-[#18181B] cursor-pointer"
                  >
                    <Settings className="h-3.5 w-3.5 text-[#E5A93B]" aria-hidden="true" />
                    <span>{t('settingsTitle')}</span>
                  </button>

                  {isAdmin && (
                    <>
                      {onOpenAdminPanel && (
                        <button
                          type="button"
                          onClick={() => {
                            setMenuOpen(false);
                            onOpenAdminPanel();
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-[#E5A93B] hover:bg-[#18181B] cursor-pointer"
                        >
                          <ShieldCheck className="h-3.5 w-3.5 text-[#E5A93B]" aria-hidden="true" />
                          <span>Admin</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          onOpenUpload();
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-[#FAFAFA] hover:bg-[#18181B] cursor-pointer"
                      >
                        <Upload className="h-3.5 w-3.5 text-[#E5A93B]" aria-hidden="true" />
                        <span>{t('uploadMovie')}</span>
                      </button>

                      <button
                        type="button"
                        disabled={downloadingPdf}
                        onClick={() => void handleDownloadHostingPdf()}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-[#FAFAFA] hover:bg-[#18181B] disabled:opacity-50 cursor-pointer"
                      >
                        <FileText className="h-3.5 w-3.5 text-[#E5A93B]" aria-hidden="true" />
                        <span>{downloadingPdf ? t('generatingPdf') : t('hostingPdf')}</span>
                      </button>

                      <a
                        href="/api/app-zip"
                        download="templesolosmovies-app.zip"
                        onClick={() => setMenuOpen(false)}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-[#FAFAFA] hover:bg-[#18181B]"
                      >
                        <Archive className="h-3.5 w-3.5 text-[#E5A93B]" aria-hidden="true" />
                        <span>{t('downloadAppZip')}</span>
                      </a>
                    </>
                  )}

                  <a
                    href={WHATSAPP_CHANNEL_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setMenuOpen(false)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs font-medium text-emerald-300 hover:bg-[#18181B]"
                  >
                    <span className="inline-flex items-center gap-2">
                      <MessageCircle className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                      <span>{t('joinWhatsappChannel')}</span>
                    </span>
                    <ExternalLink className="h-3 w-3 text-[#71717A]" aria-hidden="true" />
                  </a>

                  <button
                    type="button"
                    onClick={handleLogOut}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-red-300 hover:bg-[#18181B] cursor-pointer"
                  >
                    <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{t('logOut')}</span>
                  </button>
                </div>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={() => onOpenAuth('login')}
              className="inline-flex items-center gap-2 rounded-lg bg-[#E5A93B] px-4 py-2 text-xs sm:text-sm font-semibold text-[#09090B] hover:bg-[#F0B84F] active:scale-[0.98] transition-all whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FAFAFA]"
            >
              <UserIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{t('logIn')}</span>
            </button>
          )}
          </div>
        </div>
      </div>
    </header>
  );
}
