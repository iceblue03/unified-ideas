import { CATEGORY_LABEL } from "../../lib/types";
import type { ResultCategory } from "../../lib/types";

interface TabDef {
  key: ResultCategory;
  label: string;
  count: number;
  disabledReason: string | null;
}

export function CategoryTabs({
  active,
  onChange,
  competitionCount,
  productCount,
  patentCount,
  useAi,
  shoppingAvailable,
  patentAvailable,
}: {
  active: ResultCategory;
  onChange: (next: ResultCategory) => void;
  competitionCount: number;
  productCount: number;
  patentCount: number;
  useAi: boolean;
  shoppingAvailable: boolean;
  patentAvailable: boolean;
}) {
  const tabs: TabDef[] = [
    { key: "competition", label: CATEGORY_LABEL.competition, count: competitionCount, disabledReason: null },
    {
      key: "product",
      label: CATEGORY_LABEL.product,
      count: productCount,
      disabledReason: !useAi ? "AI 필요" : !shoppingAvailable ? "미설정" : null,
    },
    {
      key: "patent",
      label: CATEGORY_LABEL.patent,
      count: patentCount,
      disabledReason: !useAi ? "AI 필요" : !patentAvailable ? "미설정" : null,
    },
  ];

  return (
    <div className="-mx-1 flex flex-wrap gap-1 overflow-x-auto px-1 pb-1">
      {tabs.map((tab) => {
        const isDisabled = tab.disabledReason !== null;
        const isActive = active === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            disabled={isDisabled}
            onClick={() => onChange(tab.key)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              isDisabled
                ? "cursor-not-allowed bg-zinc-50 text-zinc-300"
                : isActive
                  ? "bg-zinc-900 text-white shadow-sm"
                  : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"
            }`}
          >
            {tab.label} {isDisabled ? `(${tab.disabledReason})` : tab.count}
          </button>
        );
      })}
    </div>
  );
}
