import { FolderKanban } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useProjectStore } from '@/stores/projectStore';
import { useUIStore } from '@/stores/uiStore';

export const ProjectSwitcher = () => {
  const { t } = useTranslation();
  const projects = useProjectStore((state) => state.projects);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const selectProject = useProjectStore((state) => state.selectProject);
  const openModal = useUIStore((state) => state.openModal);
  const createProjectOption = '__create_project__';

  const handleProjectChange = (value: string) => {
    if (value === createProjectOption) {
      openModal('create-project');
      return;
    }

    if (value) selectProject(value);
  };

  return (
    <div className="flex min-w-0 items-center gap-1.5 border-l border-slate-700 pl-3">
      <FolderKanban className="h-4 w-4 shrink-0 text-emerald-300" />
      <select
        id="workspace-project-switcher"
        aria-label={t('projects.activeProject')}
        value={activeProjectId || ''}
        onChange={(event) => handleProjectChange(event.target.value)}
        className="max-w-24 truncate bg-transparent text-xs font-semibold text-slate-200 outline-none sm:max-w-44"
      >
        {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        <option value={createProjectOption}>＋ {t('projects.createNew')}…</option>
      </select>
    </div>
  );
};
