/** Google's official full-colour "G", served as an image so theme styles never recolour it. */
export function GoogleMark({
  className,
  "data-icon": dataIcon,
}: {
  className?: string
  /** Forwarded so `Button`'s `has-data-[icon=…]` padding sees the mark. */
  "data-icon"?: string
}) {
  return (
    <img
      alt=""
      aria-hidden="true"
      className={className}
      data-icon={dataIcon}
      src="/brand/google-g.svg"
    />
  )
}
