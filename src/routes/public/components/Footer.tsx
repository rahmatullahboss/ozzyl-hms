/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';

interface FooterProps {
  hospitalName: string;
  address?: string;
  phone?: string;
  email?: string;
  whatsappNumber?: string;
  facebookUrl?: string;
  basePath: string;
  subdomain?: string;
  lang?: string;
  emergencyNumber?: string;
  ambulanceNumber?: string;
}

export const Footer: FC<FooterProps> = (props) => {
  const isBn = props.lang === 'bn';
  const staffLoginPath = '/login';
  const waNumber = props.whatsappNumber?.replace(/\D/g, '');
  const waMessage = encodeURIComponent(
    isBn
      ? `হ্যালো, আমি ${props.hospitalName}-এ অ্যাপয়েন্টমেন্ট বুক করতে চাই`
      : `Hi, I'd like to book an appointment at ${props.hospitalName}`
  );

  return (
    <>
      <footer class="footer" role="contentinfo">
        <div class="container">
          <div class="footer-grid">
            <div class="footer-brand">
              <h3>🏥 {props.hospitalName}</h3>
              {props.address && <p>{props.address}</p>}
              {props.phone && <p>📞 {props.phone}</p>}
              {props.email && <p>✉️ {props.email}</p>}
              {props.emergencyNumber && (
                <p style="margin-top:0.5rem">
                  🚨 <strong>{isBn ? 'জরুরি' : 'Emergency'}:</strong>{' '}
                  <a href={`tel:${props.emergencyNumber.replace(/\D/g, '')}`} style="font-weight:700">
                    {props.emergencyNumber}
                  </a>
                </p>
              )}
              {props.ambulanceNumber && (
                <p>
                  🚑 <strong>{isBn ? 'অ্যাম্বুলেন্স' : 'Ambulance'}:</strong>{' '}
                  <a href={`tel:${props.ambulanceNumber.replace(/\D/g, '')}`} style="font-weight:700">
                    {props.ambulanceNumber}
                  </a>
                </p>
              )}
            </div>
            <div class="footer-links">
              <h4>{isBn ? 'দ্রুত লিংক' : 'Quick Links'}</h4>
              <a href={`${props.basePath}/doctors`}>{isBn ? 'আমাদের ডাক্তার' : 'Our Doctors'}</a>
              <a href={`${props.basePath}/services`}>{isBn ? 'সেবাসমূহ' : 'Services'}</a>
              <a href={`${props.basePath}/about`}>{isBn ? 'আমাদের সম্পর্কে' : 'About Us'}</a>
              <a href={`${props.basePath}/contact`}>{isBn ? 'যোগাযোগ' : 'Contact'}</a>
            </div>
            <div class="footer-links">
              <h4>{isBn ? 'রোগী' : 'Patient'}</h4>
              <a href="/patient/login">{isBn ? 'পেশেন্ট পোর্টাল' : 'Patient Portal'}</a>
              <a href={staffLoginPath}>{isBn ? 'হাসপাতাল লগইন' : 'Hospital Login'}</a>
              {props.whatsappNumber && (
                <a href={`https://wa.me/${waNumber}?text=${waMessage}`}
                   target="_blank" rel="noopener noreferrer">
                  WhatsApp
                </a>
              )}
              {props.facebookUrl && (
                <a href={props.facebookUrl} target="_blank" rel="noopener noreferrer">
                  Facebook
                </a>
              )}
            </div>
          </div>
          <div class="footer-bottom">
            <p>© {new Date().getFullYear()} {props.hospitalName}. Powered by{' '}
              <a href={`https://hms.ozzyl.com?ref=${props.subdomain || 'hospital-site'}`} target="_blank" rel="noopener noreferrer"
                style="opacity:0.6;text-decoration:underline">Ozzyl Health</a>.</p>
          </div>
        </div>
      </footer>

      {/* Floating WhatsApp Button */}
      {waNumber && (
        <a href={`https://wa.me/${waNumber}?text=${waMessage}`}
          target="_blank" rel="noopener noreferrer"
          class="whatsapp-float"
          aria-label="Chat on WhatsApp"
          style="position:fixed;bottom:1.5rem;right:1.5rem;z-index:999;width:56px;height:56px;border-radius:50%;background:#25d366;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(37,211,102,0.4);transition:transform 0.2s">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
          </svg>
        </a>
      )}
    </>
  );
};
