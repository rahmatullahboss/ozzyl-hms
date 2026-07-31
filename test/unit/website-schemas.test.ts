import { describe, it, expect } from 'vitest';
import {
  websiteConfigSchema,
  websiteServiceSchema,
  blogPostSchema,
  departmentSchema,
  reviewSchema
} from '../../src/schemas/website';

describe('Website Schemas', () => {
  describe('websiteConfigSchema', () => {
    it('accepts valid config with theme and tagline', () => {
      const config = { theme: 'medtrust', tagline: 'Your health, our priority' };
      const result = websiteConfigSchema.parse(config);
      expect(result.theme).toBe('medtrust');
      expect(result.tagline).toBe('Your health, our priority');
    });

    it('accepts valid full config', () => {
      const config = {
        is_enabled: 1,
        theme: 'arogyaseva',
        tagline: 'Hello',
        tagline_bn: 'হ্যালো',
        about_text: 'About us',
        about_text_bn: 'আমাদের সম্পর্কে',
        mission_text: 'Mission',
        mission_text_bn: 'মিশন',
        founded_year: 2020,
        bed_count: 50,
        operating_hours: '24/7',
        google_maps_embed: 'https://maps.google.com/...',
        whatsapp_number: '+1234567890',
        facebook_url: 'https://facebook.com/hospital',
        emergency_number: '911',
        ambulance_number: '912',
        emergency_hours: '24/7',
        seo_title: 'Hospital Title',
        seo_description: 'Best hospital',
        seo_keywords: 'hospital, doctor',
        primary_color: '#ff0000',
        secondary_color: '#00ff00'
      };
      const result = websiteConfigSchema.parse(config);
      expect(result).toEqual(config);
    });

    it('rejects invalid theme', () => {
      const config = { theme: 'invalid-theme' };
      expect(() => websiteConfigSchema.parse(config)).toThrow();
    });

    it('rejects invalid founded_year boundaries', () => {
      expect(() => websiteConfigSchema.parse({ founded_year: 1799 })).toThrow(); // min is 1800
      expect(() => websiteConfigSchema.parse({ founded_year: 2101 })).toThrow(); // max is 2100
    });

    it('rejects invalid bed_count boundaries', () => {
      expect(() => websiteConfigSchema.parse({ bed_count: -1 })).toThrow(); // min is 0
      expect(() => websiteConfigSchema.parse({ bed_count: 10001 })).toThrow(); // max is 10000
    });

    it('rejects invalid facebook_url format', () => {
      const config = { facebook_url: 'not-a-url' };
      expect(() => websiteConfigSchema.parse(config)).toThrow();
    });

    it('rejects invalid color hex code formats', () => {
      expect(() => websiteConfigSchema.parse({ primary_color: 'red' })).toThrow();
      expect(() => websiteConfigSchema.parse({ secondary_color: '#123' })).toThrow(); // needs 6 digits
      expect(() => websiteConfigSchema.parse({ primary_color: '#1234567' })).toThrow();
    });

    it('rejects is_enabled outside of 0 or 1', () => {
        expect(() => websiteConfigSchema.parse({ is_enabled: -1 })).toThrow();
        expect(() => websiteConfigSchema.parse({ is_enabled: 2 })).toThrow();
    });
  });

  describe('websiteServiceSchema', () => {
    it('accepts valid service', () => {
      const service = { name: 'Surgery', description: 'General Surgery', icon: '🏥', category: 'general' };
      const result = websiteServiceSchema.parse(service);
      expect(result.name).toBe('Surgery');
      expect(result.category).toBe('general');
    });

    it('rejects missing name', () => {
      const service = { description: 'General Surgery' };
      expect(() => websiteServiceSchema.parse(service)).toThrow();
    });

    it('rejects invalid category enum', () => {
      const service = { name: 'Surgery', category: 'invalid-category' };
      expect(() => websiteServiceSchema.parse(service)).toThrow();
    });

    it('accepts all valid categories', () => {
      const categories = ['general', 'opd', 'ipd', 'lab', 'pharmacy', 'telemedicine', 'emergency'] as const;
      for (const category of categories) {
        const service = { name: 'Test', category };
        const result = websiteServiceSchema.parse(service);
        expect(result.category).toBe(category);
      }
    });

    it('rejects invalid is_active bounds', () => {
        expect(() => websiteServiceSchema.parse({ name: 'Surgery', is_active: 2 })).toThrow();
    });

    it('rejects negative sort_order', () => {
        expect(() => websiteServiceSchema.parse({ name: 'Surgery', sort_order: -1 })).toThrow();
    });
  });

  describe('blogPostSchema', () => {
    it('accepts valid blog post', () => {
      const post = {
        title: 'Healthy Living',
        slug: 'healthy-living',
        content: 'Eat vegetables and exercise.',
        is_published: 1
      };
      const result = blogPostSchema.parse(post);
      expect(result.title).toBe('Healthy Living');
      expect(result.slug).toBe('healthy-living');
    });

    it('rejects missing title', () => {
      const post = { slug: 'healthy-living', content: '...' };
      expect(() => blogPostSchema.parse(post)).toThrow();
    });

    it('rejects missing content', () => {
        const post = { title: 'Healthy Living', slug: 'healthy-living' };
        expect(() => blogPostSchema.parse(post)).toThrow();
    });

    it('rejects invalid slug format', () => {
      const post1 = { title: 'Title', slug: 'Healthy Living', content: '...' }; // caps and spaces
      expect(() => blogPostSchema.parse(post1)).toThrow();

      const post2 = { title: 'Title', slug: 'healthy_living', content: '...' }; // underscores
      expect(() => blogPostSchema.parse(post2)).toThrow();

      const post3 = { title: 'Title', slug: '-healthy', content: '...' }; // starts with hyphen
      expect(() => blogPostSchema.parse(post3)).toThrow();
    });

    it('rejects invalid is_published bounds', () => {
        expect(() => blogPostSchema.parse({ title: 'T', slug: 't', content: 'c', is_published: -1 })).toThrow();
    });
  });

  describe('departmentSchema', () => {
    it('accepts valid department', () => {
      const dept = {
        name: 'Cardiology',
        slug: 'cardiology',
        description: 'Heart care',
        is_active: 1
      };
      const result = departmentSchema.parse(dept);
      expect(result.name).toBe('Cardiology');
      expect(result.slug).toBe('cardiology');
    });

    it('rejects invalid slug format', () => {
      const dept = { name: 'Cardiology', slug: 'Cardiology Dept' };
      expect(() => departmentSchema.parse(dept)).toThrow();
    });

    it('rejects missing name', () => {
        expect(() => departmentSchema.parse({ slug: 'cardio' })).toThrow();
    });

    it('rejects missing slug', () => {
        expect(() => departmentSchema.parse({ name: 'Cardiology' })).toThrow();
    });
  });

  describe('reviewSchema', () => {
    it('accepts valid review', () => {
      const review = { rating: 5, review_text: 'Great service' };
      const result = reviewSchema.parse(review);
      expect(result.rating).toBe(5);
      expect(result.review_text).toBe('Great service');
    });

    it('rejects rating below 1', () => {
      const review = { rating: 0 };
      expect(() => reviewSchema.parse(review)).toThrow();
    });

    it('rejects rating above 5', () => {
      const review = { rating: 6 };
      expect(() => reviewSchema.parse(review)).toThrow();
    });

    it('rejects missing rating', () => {
      expect(() => reviewSchema.parse({ review_text: 'Good' })).toThrow();
    });
  });
});
