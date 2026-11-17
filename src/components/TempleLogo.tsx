interface IconProps {
  className?: string;
}

export function TempleLogoIcon({ className = 'h-7 w-7' }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <rect
        x="1.5"
        y="1.5"
        width="61"
        height="61"
        rx="14"
        fill="#0A0A0C"
        stroke="#E6A93C"
        strokeOpacity="0.38"
        strokeWidth="1.5"
      />
      <path fill="#E6A93C" d="M32 10L53 21.5H11L32 10Z" />
      <rect x="12" y="23.5" width="40" height="3.5" rx="0.75" fill="#E6A93C" />
      <path
        fill="#E6A93C"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M15 28.5H23V46H15V28.5ZM17.4 31.2V33.8H20.6V31.2H17.4ZM17.4 36V38.6H20.6V36H17.4ZM17.4 40.8V43.4H20.6V40.8H17.4Z"
      />
      <path
        fill="#E6A93C"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M28 28.5H36V46H28V28.5ZM30.4 31.2V33.8H33.6V31.2H30.4ZM30.4 36V38.6H33.6V36H30.4ZM30.4 40.8V43.4H33.6V40.8H30.4Z"
      />
      <path
        fill="#E6A93C"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M41 28.5H49V46H41V28.5ZM43.4 31.2V33.8H46.6V31.2H43.4ZM43.4 36V38.6H46.6V36H43.4ZM43.4 40.8V43.4H46.6V40.8H43.4Z"
      />
      <rect x="12" y="47.5" width="40" height="3.5" rx="0.75" fill="#E6A93C" />
      <rect x="9" y="52.5" width="46" height="4" rx="1" fill="#E6A93C" />
    </svg>
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
