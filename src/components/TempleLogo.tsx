interface IconProps {
  className?: string;
}

export function TempleLogoIcon({ className = 'h-7 w-7' }: IconProps) {
  return (
    <img
      src="/icons/icon-192.png"
      alt=""
      aria-hidden="true"
      width={64}
      height={64}
      decoding="async"
      className={`${className} rounded-lg bg-black object-contain`}
    />
  );
}

export function TempleNavHomeIcon({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path fill="currentColor" d="M12 3L21.5 8.5H2.5L12 3Z" />
      <rect x="3" y="9.5" width="18" height="1.5" rx="0.4" fill="currentColor" />
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M4 12H8V18.5H4V12ZM5.2 13V14.6H6.8V13H5.2ZM5.2 15.8V17.4H6.8V15.8H5.2Z"
      />
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10 12H14V18.5H10V12ZM11.2 13V14.6H12.8V13H11.2ZM11.2 15.8V17.4H12.8V15.8H11.2Z"
      />
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M16 12H20V18.5H16V12ZM17.2 13V14.6H18.8V13H17.2ZM17.2 15.8V17.4H18.8V15.8H17.2Z"
      />
      <rect x="2.5" y="19.5" width="19" height="2" rx="0.6" fill="currentColor" />
    </svg>
  );
}
