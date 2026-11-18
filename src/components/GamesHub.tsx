import { ArrowLeft, Gamepad2, Trophy } from 'lucide-react';
import { FootballArena } from '../games/football/FootballArena';

interface GamesHubProps {
  defaultPlayerId: string;
  defaultPlayerName: string;
  onBackToCinema: () => void;
  onOpenChessLounge: () => void;
}

export function GamesHub({
  defaultPlayerId,
  defaultPlayerName,
  onBackToCinema,
  onOpenChessLounge,
}: GamesHubProps) {
  return (
    <section
      id="games-section"
      aria-labelledby="games-hub-heading"
      className="min-h-[82vh] w-full max-w-full bg-[#09090B]"
    >
      <div className="border-b border-[#27272A] bg-[#0A0A0C]">
        <div className="mx-auto max-w-[1440px] px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-medium text-[#E5A93B] mb-1">
                <Gamepad2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>Temple Cinema Arcade</span>
              </div>
              <h1
                id="games-hub-heading"
                className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#FAFAFA]"
              >
                Games
              </h1>
              <p className="text-xs sm:text-sm text-[#A1A1AA] mt-0.5">
                3D Penalty Shootout &amp; Free Kick Challenge — play solo vs AI or online 2P with friends.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={onOpenChessLounge}
                className="min-h-[42px] inline-flex items-center gap-1.5 rounded-xl border border-[#27272A] bg-[#111114] px-3.5 py-2 text-xs font-semibold text-[#D4D4D8] hover:border-[#E5A93B] hover:text-[#E5A93B] transition-colors cursor-pointer whitespace-nowrap"
              >
                <Trophy className="h-3.5 w-3.5 text-[#E5A93B]" aria-hidden="true" />
                <span>Chess Lounge</span>
              </button>

              <button
                type="button"
                onClick={onBackToCinema}
                className="min-h-[42px] inline-flex items-center gap-1.5 rounded-xl bg-[#E5A93B] px-4 py-2 text-xs font-bold text-[#09090B] hover:bg-[#F0B84F] transition-colors cursor-pointer whitespace-nowrap"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Back to Temple Cinema</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1440px] px-3 py-5 sm:px-6 lg:px-8">
        <FootballArena
          defaultPlayerId={defaultPlayerId}
          defaultPlayerName={defaultPlayerName}
          onBackToCinema={onBackToCinema}
        />
      </div>
    </section>
  );
}
