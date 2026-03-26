import React from 'react';
import { Character } from '../types';

interface Props {
  character: Character;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
}

const CharacterCard: React.FC<Props> = ({ character, onClick, onDelete }) => {
  return (
    <div 
      onClick={onClick}
      className="group relative flex flex-col bg-gray-850 rounded-xl overflow-hidden border border-gray-750 cursor-pointer hover:border-primary-500 transition-all duration-300 hover:shadow-xl hover:shadow-primary-500/10 hover:-translate-y-1"
    >
      <div className="aspect-[3/4] overflow-hidden bg-gray-900 relative">
        <img 
          src={character.avatarUrl || `https://ui-avatars.com/api/?name=${character.name}&background=random`} 
          alt={character.name} 
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          onError={(e) => {
            (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${character.name}&background=2d3748&color=fff`;
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-transparent to-transparent opacity-80" />
        
        <button 
          onClick={onDelete}
          className="absolute top-2 right-2 bg-red-500/80 hover:bg-red-500 text-white p-2 rounded-full opacity-0 group-hover:opacity-100 transition-all z-10"
          title="Hapus Karakter"
        >
          <i className="fas fa-trash text-xs"></i>
        </button>
      </div>
      
      <div className="absolute bottom-0 w-full p-4">
        <h3 className="text-lg font-bold text-white shadow-black drop-shadow-md truncate">{character.name}</h3>
        <p className="text-gray-300 text-xs line-clamp-2 mt-1 drop-shadow-md">
            {character.description}
        </p>
      </div>
    </div>
  );
};

export default CharacterCard;