/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';

interface Review {
  id: number;
  patient_name: string;
  rating: number;
  review_text?: string;
  created_at?: string;
}

interface TestimonialCardProps {
  review: Review;
}

const StarRating: FC<{ rating: number }> = ({ rating }) => {
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    stars.push(
      <span style={`color:${i <= rating ? '#f59e0b' : '#d1d5db'};font-size:1.1rem`} aria-hidden="true">★</span>
    );
  }
  return <div style="display:flex;gap:2px" role="img" aria-label={`${rating} out of 5 stars`}>{stars}</div>;
};

export const TestimonialCard: FC<TestimonialCardProps> = ({ review }) => (
  <div class="card">
    <div class="card-body">
      <StarRating rating={review.rating} />
      {review.review_text && (
        <p style="font-size:0.95rem;line-height:1.6;opacity:0.8;margin:0.75rem 0;font-style:italic">
          "{review.review_text.length > 200 ? review.review_text.slice(0, 200) + '...' : review.review_text}"
        </p>
      )}
      <p style="font-size:0.85rem;font-weight:600;opacity:0.6">— {review.patient_name}</p>
    </div>
  </div>
);

interface TestimonialSectionProps {
  reviews: Review[];
  lang?: string;
}

export const TestimonialSection: FC<TestimonialSectionProps> = ({ reviews, lang }) => {
  if (reviews.length === 0) return null;
  const isBn = lang === 'bn';

  return (
    <section class="section">
      <div class="container">
        <h2 class="section-title text-center">{isBn ? 'রোগীদের মতামত' : 'What Our Patients Say'}</h2>
        <p class="section-subtitle text-center">
          {isBn ? 'আমাদের রোগীদের অভিজ্ঞতা' : 'Real experiences from our patients'}
        </p>
        <div class="grid grid-3">
          {reviews.slice(0, 6).map((review) => (
            <TestimonialCard review={review} />
          ))}
        </div>
      </div>
    </section>
  );
};
