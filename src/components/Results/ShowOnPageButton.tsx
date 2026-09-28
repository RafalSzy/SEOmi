import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Crosshair, LoaderCircle } from 'lucide-react';
import { openRenderedElementPreview } from '@/services/tauri';

interface ShowOnPageButtonProps {
  url: string;
  selector: string;
  needle?: string;
  domIndex?: number;
  label: string;
}

/** Opens a same-host native WebView and highlights the audited element. */
export const ShowOnPageButton = ({ url, selector, needle, domIndex, label }: ShowOnPageButtonProps) => {
  const { t } = useTranslation();
  const [isOpening, setIsOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpen = async () => {
    setIsOpening(true);
    setError(null);
    try {
      const preview = { url, selector, ...(needle ? { needle } : {}), ...(Number.isInteger(domIndex) ? { domIndex } : {}) };
      await openRenderedElementPreview(preview);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('componentUi.previewError'));
    } finally {
      setIsOpening(false);
    }
  };

  return (
    <span className="inline-flex max-w-full flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => void handleOpen()}
        disabled={isOpening}
        aria-label={t('componentUi.showOnPageAria', { label })}
        title={t('componentUi.showOnPageTitle')}
        className="inline-flex items-center gap-1 rounded-md border border-sky-400/30 bg-sky-400/10 px-2 py-1 text-[10px] font-medium text-sky-200 transition hover:border-sky-300/70 hover:bg-sky-400/20 disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
      >
        {isOpening ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <Crosshair className="h-3 w-3" />}
        {t('componentUi.showOnPage')}
      </button>
      {error && <span role="alert" className="max-w-64 break-words text-[10px] text-rose-300">{error}</span>}
    </span>
  );
};
