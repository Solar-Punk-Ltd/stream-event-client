import './LinkIcon.scss';

/**
 * A small icon before a link's words. Drawn as a mask, as the social links are, so it takes the link's
 * colour whatever colours its file uses, and follows it on hover.
 */
export function LinkIcon({ url }: { url: string }) {
  return (
    <span
      className="link-icon"
      style={{ maskImage: `url("${url}")`, WebkitMaskImage: `url("${url}")` }}
      aria-hidden="true"
    />
  );
}
