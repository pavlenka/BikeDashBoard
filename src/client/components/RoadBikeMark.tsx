export function RoadBikeMark() {
  return (
    <svg className="road-bike-mark" viewBox="0 0 68 36" aria-hidden="true">
      <circle cx="14" cy="25" r="9.5" />
      <circle cx="54" cy="25" r="9.5" />
      <path d="M14 25 28 24 23 11 42 13 28 24 14 25 23 11M42 13l12 12M42 13l5-7" />
      <path className="road-bike-mark__bar" d="M47 6h7c2.8 0 3.8 1.7 3.8 3.5 0 2.4-1.8 3.8-4.1 3.8h-2.4" />
      <path className="road-bike-mark__seat" d="m19.5 10 8.5.7" />
      <circle className="road-bike-mark__crank" cx="28" cy="24" r="2.2" />
      <path className="road-bike-mark__crank" d="m28 24 5 3" />
    </svg>
  );
}
