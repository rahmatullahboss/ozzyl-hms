/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';

interface Department {
  id: number;
  name: string;
  name_bn?: string;
  slug: string;
  description?: string;
  description_bn?: string;
  icon?: string;
  image_key?: string;
}

interface DepartmentCardProps {
  department: Department;
  basePath: string;
  lang?: string;
}

export const DepartmentCard: FC<DepartmentCardProps> = ({ department, basePath, lang }) => {
  const isBn = lang === 'bn';
  const name = isBn ? (department.name_bn || department.name) : department.name;
  const desc = isBn ? (department.description_bn || department.description) : department.description;

  return (
    <a href={`${basePath}/doctors?dept=${encodeURIComponent(department.name)}`}
      class="card" style="text-decoration:none;color:inherit">
      {department.image_key ? (
        <img src={`/api/uploads/${department.image_key}`} alt={name}
          style="width:100%;height:160px;object-fit:cover" loading="lazy" />
      ) : (
        <div style="width:100%;height:120px;display:flex;align-items:center;justify-content:center;font-size:3rem;background:var(--color-bg-alt,#f0f4f8)">
          {department.icon || '🏥'}
        </div>
      )}
      <div class="card-body">
        <h3 style="font-size:1.05rem;font-weight:600;margin-bottom:0.25rem">{name}</h3>
        {desc && (
          <p style="font-size:0.85rem;opacity:0.7;line-height:1.5">
            {desc.length > 120 ? desc.slice(0, 120) + '...' : desc}
          </p>
        )}
      </div>
    </a>
  );
};

interface DepartmentListProps {
  departments: Department[];
  basePath: string;
  lang?: string;
}

export const DepartmentList: FC<DepartmentListProps> = ({ departments, basePath, lang }) => (
  <div class="grid grid-3">
    {departments.map((dept) => (
      <DepartmentCard department={dept} basePath={basePath} lang={lang} />
    ))}
  </div>
);
