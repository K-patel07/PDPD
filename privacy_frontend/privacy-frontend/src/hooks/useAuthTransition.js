// hooks/useAuthTransition.js
import { useNavigate } from 'react-router-dom';
import { useState, useRef } from 'react';

// Keep track of rotation state globally to maintain loop
let currentRotation = 0;

export const useAuthTransition = () => {
  const navigate = useNavigate();
  const [isTransitioning, setIsTransitioning] = useState(false);
  const transitionTimeoutRef = useRef(null);

  const triggerTransition = (targetRoute) => {
    if (isTransitioning) return;
    
    setIsTransitioning(true);
    const card = document.querySelector('.auth-card');
    const currentHero = document.querySelector('.auth-hero');
    const currentForm = document.querySelector('.auth-form');
    
    if (!card || !currentHero || !currentForm) {
      navigate(targetRoute);
      setIsTransitioning(false);
      return;
    }

    // Clear any existing timeouts
    if (transitionTimeoutRef.current) {
      clearTimeout(transitionTimeoutRef.current);
    }

    // Determine transition direction
    const isGoingToSignup = targetRoute.includes('signup');
    
    // Phase 1: Smooth slide out current content (400ms)
    currentForm.style.transition = 'transform 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
    currentHero.style.transition = 'transform 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
    
    currentForm.classList.add(isGoingToSignup ? 'slide-out-left' : 'slide-out-right');
    currentHero.classList.add(isGoingToSignup ? 'slide-out-right' : 'slide-out-left');
    
    // Phase 2: Start rotating card with smooth scaling (500ms)
    setTimeout(() => {
      card.style.transition = 'transform 0.6s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.6s cubic-bezier(0.4, 0, 0.2, 1)';
      card.classList.add('transitioning');
      
      // Add 120 degrees to current rotation and loop every 360 degrees
      currentRotation = (currentRotation + 120) % 360;
      
      // Apply the rotation class
      card.classList.remove('rotate-120', 'rotate-240', 'rotate-360');
      if (currentRotation === 120) {
        card.classList.add('rotate-120');
      } else if (currentRotation === 240) {
        card.classList.add('rotate-240');
      } else if (currentRotation === 0) {
        card.classList.add('rotate-360');
      }
    }, 400);
    
    // Phase 3: Navigate during rotation (800ms)
    setTimeout(() => {
      navigate(targetRoute);
    }, 800);
    
    // Phase 4: Complete rotation and start sliding in content (1200ms)
    setTimeout(() => {
      const newCard = document.querySelector('.auth-card');
      const newHero = document.querySelector('.auth-hero');
      const newForm = document.querySelector('.auth-form');
      
      if (newCard && newHero && newForm) {
        // Reset transitions for new elements
        newCard.style.transition = '';
        newHero.style.transition = '';
        newForm.style.transition = '';
        
        // Hide rotating circle
        newCard.classList.remove('transitioning');
        
        // Set up for slide in animation
        newForm.classList.add(isGoingToSignup ? 'slide-in-right' : 'slide-in-left');
        newHero.classList.add(isGoingToSignup ? 'slide-in-left' : 'slide-in-right');
        
        // Trigger slide in after a brief delay
        setTimeout(() => {
          newForm.classList.add('active');
          newHero.classList.add('active');
        }, 50);
      }
    }, 1200);
    
    // Phase 5: Clean up all classes (1800ms)
    transitionTimeoutRef.current = setTimeout(() => {
      const newCard = document.querySelector('.auth-card');
      const newHero = document.querySelector('.auth-hero');
      const newForm = document.querySelector('.auth-form');
      
      if (newCard && newHero && newForm) {
        // Clean up rotation classes but keep the rotation state for next time
        newCard.classList.remove('transitioning', 'rotate-120', 'rotate-240', 'rotate-360');
        
        // Clean up slide classes
        newForm.classList.remove('slide-in-right', 'slide-in-left', 'active', 'slide-out-left', 'slide-out-right');
        newHero.classList.remove('slide-in-left', 'slide-in-right', 'active', 'slide-out-left', 'slide-out-right');
        
        // Reset inline styles
        newCard.style.transition = '';
        newHero.style.transition = '';
        newForm.style.transition = '';
      }
      
      setIsTransitioning(false);
    }, 1800);
  };

  return { triggerTransition, isTransitioning };
};