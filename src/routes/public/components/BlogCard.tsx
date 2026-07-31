/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';

interface BlogPost {
  id: number;
  title: string;
  title_bn?: string;
  slug: string;
  excerpt?: string;
  excerpt_bn?: string;
  featured_image_key?: string;
  author_name?: string;
  published_at?: string;
}

interface BlogCardProps {
  post: BlogPost;
  basePath: string;
  lang?: string;
}

export const BlogCard: FC<BlogCardProps> = ({ post, basePath, lang }) => {
  const isBn = lang === 'bn';
  const title = isBn ? (post.title_bn || post.title) : post.title;
  const excerpt = isBn ? (post.excerpt_bn || post.excerpt) : post.excerpt;
  const date = post.published_at
    ? new Date(post.published_at).toLocaleDateString(isBn ? 'bn-BD' : 'en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
      })
    : '';

  return (
    <a href={`${basePath}/blog/${post.slug}`} class="card" style="text-decoration:none;color:inherit">
      {post.featured_image_key && (
        <img src={`/api/uploads/${post.featured_image_key}`} alt={title}
          style="width:100%;height:200px;object-fit:cover" loading="lazy" />
      )}
      <div class="card-body">
        <h3 style="font-size:1.1rem;font-weight:600;margin-bottom:0.5rem;line-height:1.4">{title}</h3>
        {excerpt && (
          <p style="font-size:0.9rem;opacity:0.7;line-height:1.5;margin-bottom:0.75rem">
            {excerpt.length > 150 ? excerpt.slice(0, 150) + '...' : excerpt}
          </p>
        )}
        <div style="display:flex;align-items:center;gap:0.5rem;font-size:0.8rem;opacity:0.5">
          {post.author_name && <span>{post.author_name}</span>}
          {post.author_name && date && <span>·</span>}
          {date && <span>{date}</span>}
        </div>
      </div>
    </a>
  );
};

interface BlogListProps {
  posts: BlogPost[];
  basePath: string;
  lang?: string;
}

export const BlogList: FC<BlogListProps> = ({ posts, basePath, lang }) => (
  <div class="grid grid-3">
    {posts.map((post) => (
      <BlogCard post={post} basePath={basePath} lang={lang} />
    ))}
  </div>
);

interface BlogPostPageProps {
  post: BlogPost & { content?: string; content_bn?: string };
  basePath: string;
  lang?: string;
}

export const BlogPostPage: FC<BlogPostPageProps> = ({ post, basePath, lang }) => {
  const isBn = lang === 'bn';
  const title = isBn ? (post.title_bn || post.title) : post.title;
  const content = isBn ? (post.content_bn || post.content) : post.content;
  const date = post.published_at
    ? new Date(post.published_at).toLocaleDateString(isBn ? 'bn-BD' : 'en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
      })
    : '';

  return (
    <section class="section">
      <div class="container" style="max-width:800px">
        <a href={`${basePath}/blog`} style="font-size:0.9rem;opacity:0.6;display:inline-block;margin-bottom:1.5rem">
          ← {isBn ? 'সব পোস্ট' : 'All Posts'}
        </a>
        {post.featured_image_key && (
          <img src={`/api/uploads/${post.featured_image_key}`} alt={title}
            style="width:100%;max-height:400px;object-fit:cover;border-radius:1rem;margin-bottom:2rem" />
        )}
        <h1 style="font-size:2rem;font-weight:800;line-height:1.3;margin-bottom:1rem">{title}</h1>
        <div style="display:flex;align-items:center;gap:0.5rem;font-size:0.9rem;opacity:0.5;margin-bottom:2rem">
          {post.author_name && <span>{post.author_name}</span>}
          {post.author_name && date && <span>·</span>}
          {date && <span>{date}</span>}
        </div>
        {content && (
          <div style="font-size:1.05rem;line-height:1.8;opacity:0.85">
            {content.split('\n').map((para: string) => (
              para.trim() ? <p style="margin-bottom:1rem">{para}</p> : null
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
