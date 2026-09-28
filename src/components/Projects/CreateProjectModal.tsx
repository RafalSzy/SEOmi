import { FormEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderPlus, Globe2, X } from "lucide-react";
import { useProjectStore } from "@/stores/projectStore";
import { useUIStore } from "@/stores/uiStore";
import {
  validateProjectName,
  validateProjectRootUrl,
} from "@/services/projectValidation";
import { useModalA11y } from "@/hooks/useModalA11y";

export const CreateProjectModal = () => {
  const { t } = useTranslation();
  const createProject = useProjectStore((state) => state.createProject);
  const closeModal = useUIStore((state) => state.closeModal);
  const nameInput = useRef<HTMLInputElement>(null);
  const dialogRef = useModalA11y<HTMLElement>(closeModal);
  const [name, setName] = useState("");
  const [rootUrl, setRootUrl] = useState("");
  const [validationError, setValidationError] = useState("");
  const [validationField, setValidationField] = useState<
    "name" | "rootUrl" | null
  >(null);

  useEffect(() => {
    nameInput.current?.focus();
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const nameValidation = validateProjectName(name);
    if (!nameValidation.ok) {
      setValidationError(nameValidation.message);
      setValidationField("name");
      nameInput.current?.focus();
      return;
    }

    const rootValidation = validateProjectRootUrl(rootUrl);
    if (!rootValidation.ok) {
      setValidationError(rootValidation.message);
      setValidationField("rootUrl");
      return;
    }

    try {
      createProject({ name, rootUrl: rootValidation.value });
      closeModal();
    } catch (error) {
      setValidationError(
        error instanceof Error ? error.message : t("projects.createError"),
      );
      setValidationField("rootUrl");
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeModal();
      }}
    >
      <section
        ref={dialogRef}
        aria-labelledby="create-project-title"
        aria-describedby="create-project-description"
        aria-modal="true"
        tabIndex={-1}
        className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
        role="dialog"
      >
        <header className="flex items-start justify-between border-b border-slate-800 bg-slate-950/70 px-5 py-4">
          <div className="flex gap-3">
            <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/10 p-2.5 text-emerald-300">
              <FolderPlus className="h-5 w-5" />
            </div>
            <div>
              <h2
                id="create-project-title"
                className="text-base font-semibold text-white"
              >
                {t("projects.newProject")}
              </h2>
              <p
                id="create-project-description"
                className="mt-0.5 text-xs leading-5 text-slate-400"
              >
                {t("projects.dataDescription")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeModal}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white"
            aria-label={t("projects.closeCreate")}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <form onSubmit={submit} className="space-y-4 p-5">
          <label className="block text-xs font-medium text-slate-300">
            {t("projects.name")}
            <input
              ref={nameInput}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (event.target.value.trim()) {
                  setValidationError("");
                  setValidationField(null);
                }
              }}
              aria-invalid={validationField === "name"}
              aria-describedby={
                validationField === "name"
                  ? "create-project-name-error"
                  : undefined
              }
              required
              maxLength={80}
              placeholder={t("projects.namePlaceholder")}
              className="mt-2 h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-emerald-400"
            />
            {validationError && validationField === "name" && (
              <span
                id="create-project-name-error"
                role="alert"
                className="mt-2 block text-xs text-rose-300"
              >
                {validationError}
              </span>
            )}
          </label>
          <label className="block text-xs font-medium text-slate-300">
            {t("projects.startingDomain")}{" "}
            <span className="font-normal text-slate-500">
              ({t("projects.optional")})
            </span>
            <span className="relative mt-2 block">
              <Globe2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                value={rootUrl}
                onChange={(event) => {
                  setRootUrl(event.target.value);
                  if (validationField === "rootUrl") {
                    setValidationError("");
                    setValidationField(null);
                  }
                }}
                aria-invalid={validationField === "rootUrl"}
                aria-describedby={
                  validationField === "rootUrl"
                    ? "create-project-root-url-error"
                    : undefined
                }
                maxLength={2048}
              placeholder={t('projects.startingDomainPlaceholder')}
                className="h-11 w-full rounded-lg border border-slate-700 bg-slate-950 py-0 pl-10 pr-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-emerald-400"
              />
            </span>
            {validationError && validationField === "rootUrl" && (
              <span
                id="create-project-root-url-error"
                role="alert"
                className="mt-2 block text-xs text-rose-300"
              >
                {validationError}
              </span>
            )}
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={closeModal}
              className="h-10 rounded-lg border border-slate-700 px-3 text-sm font-medium text-slate-300 transition hover:bg-slate-800 hover:text-white"
            >
              {t("projects.cancel")}
            </button>
            <button
              type="submit"
              className="flex h-10 items-center gap-2 rounded-lg bg-emerald-400 px-4 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300"
            >
              {t("projects.createAndOpen")}
              <FolderPlus className="h-4 w-4" />
            </button>
          </div>
        </form>
      </section>
    </div>
  );
};
