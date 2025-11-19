import React from 'react';

interface StarRatingProps {
  rating: number;
  size?: 'sm' | 'md' | 'lg';
}

export default function StarRating({ rating, size = 'md' }: StarRatingProps) {
  const sizeClasses = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-lg'
  };

  const filledStars = Math.round(rating * 2) / 2; // Redondea al medio punto más cercano
  
  return (
    <div className={`flex items-center ${sizeClasses[size]}`}>
      {[1, 2, 3, 4, 5].map((star) => {
        const starClass = filledStars >= star 
          ? 'text-yellow-400' 
          : filledStars >= star - 0.5 
            ? 'text-yellow-400' 
            : 'text-gray-300';
            
        return (
          <span key={star} className={starClass}>
            {filledStars >= star ? '★' : filledStars >= star - 0.5 ? '½' : '☆'}
          </span>
        );
      })}
      <span className="ml-1 text-gray-600 text-sm">
        {rating.toFixed(1)}
      </span>
    </div>
  );
}
